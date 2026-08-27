import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { createPublicKey, generateKeyPairSync, randomBytes, randomUUID } from 'node:crypto';
import * as jwt from 'jsonwebtoken';
import { PrismaService } from '../../../../../kernel/prisma/prisma.service';
import { TenantContextService } from '../../../../../kernel/tenancy/tenant-context.service';
import { EncryptionService } from '../../../../../kernel/encryption/encryption.service';
import { PortalIdentityService } from '../../../../../kernel/auth/portal-identity.service';
import { ViewEnvelopeService } from '../course/view-envelope.service';
import { LmsGradeBridgeService } from '../grade/grade-bridge.service';
import { LmsEventService } from '../lms-event.service';

const LTI_VERSION = '1.3.0';
const MESSAGE_TYPE = 'LtiResourceLinkRequest';
const CLAIM = 'https://purl.imsglobal.org/spec/lti/claim';
const AGS_CLAIM = 'https://purl.imsglobal.org/spec/lti-ags/claim/endpoint';
/** Launch sessions are single-use and short-lived; OIDC round trips take seconds. */
const SESSION_TTL_MS = 5 * 60 * 1000;

/**
 * LTI 1.3 platform (L8).
 *
 * This installation is the *platform*: it signs an `id_token` that an external
 * tool verifies against our published JWKS, and it accepts grades back over AGS.
 *
 * Three things carry the security of the whole flow:
 *
 *  1. **Keys are per-organization.** A launch signed for one school must not be
 *     accepted as another's. The private key is stored AES-256-GCM encrypted.
 *  2. **The subject comes from the token, never the request.** A launch says who
 *     the learner is, and that assertion is what the tool grades — so letting a
 *     caller name someone else would let a pupil have work graded as a classmate.
 *  3. **Nonces are single-use.** OIDC requires the platform to reject a replayed
 *     launch; a consumed session is refused rather than re-signed.
 */
@Injectable()
export class LtiService {
  private readonly logger = new Logger('LtiService');

  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantContextService,
    private readonly encryption: EncryptionService,
    private readonly portalIdentity: PortalIdentityService,
    private readonly envelope: ViewEnvelopeService,
    private readonly grades: LmsGradeBridgeService,
    private readonly events: LmsEventService,
  ) {}

  private get org() {
    return this.tenant.organizationId;
  }

  /** Absolute issuer for this installation; tools key their registration on it. */
  private get issuer(): string {
    return process.env.LTI_ISSUER ?? process.env.PUBLIC_BASE_URL ?? 'http://localhost:3001';
  }

  // ── keys ───────────────────────────────────────────────────────────────────

  /**
   * The active signing key, minted on first use.
   *
   * Generating lazily means a school that never uses LTI never holds a key, and
   * one that does gets it without an operator step.
   */
  async activeKey(): Promise<{ kid: string; privateKeyPem: string; publicKeyPem: string }> {
    const existing = await this.prisma.client.ltiPlatformKey.findFirst({
      where: { organizationId: this.org, retiredAt: null },
      orderBy: { createdAt: 'desc' },
    });
    if (existing) {
      const privateKeyPem = this.encryption.decrypt({
        ciphertext: existing.privateKeyCipher,
        iv: existing.privateKeyIv,
        tag: existing.privateKeyTag,
      });
      if (!privateKeyPem) throw new BadRequestException('LTI signing key could not be decrypted');
      return { kid: existing.kid, privateKeyPem, publicKeyPem: existing.publicKeyPem };
    }
    return this.rotateKey();
  }

  /**
   * Mint a new key and retire the current one.
   *
   * The old key is retired rather than deleted: tools cache JWKS, and a launch
   * signed moments before a rotation must still verify.
   */
  async rotateKey(): Promise<{ kid: string; privateKeyPem: string; publicKeyPem: string }> {
    const { publicKey, privateKey } = generateKeyPairSync('rsa', {
      modulusLength: 2048,
      publicKeyEncoding: { type: 'spki', format: 'pem' },
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    });
    const enc = this.encryption.encrypt(privateKey);
    if (!enc) throw new BadRequestException('Encryption is not configured; cannot store an LTI key');
    const kid = randomUUID();

    await this.prisma.client.ltiPlatformKey.updateMany({
      where: { organizationId: this.org, retiredAt: null },
      data: { retiredAt: new Date() },
    });
    await this.prisma.client.ltiPlatformKey.create({
      data: {
        organizationId: this.org, kid, publicKeyPem: publicKey,
        privateKeyCipher: enc.ciphertext, privateKeyIv: enc.iv, privateKeyTag: enc.tag,
      },
    });
    this.logger.log(`Minted LTI platform key ${kid} for org ${this.org}`);
    return { kid, privateKeyPem: privateKey, publicKeyPem: publicKey };
  }

  /**
   * Public JWKS. Includes retired keys so a tool can still verify a launch it
   * received just before a rotation.
   */
  async jwks(): Promise<{ keys: Array<Record<string, string>> }> {
    const rows = await this.prisma.client.ltiPlatformKey.findMany({
      where: { organizationId: this.org },
      orderBy: { createdAt: 'desc' },
      take: 5,
    });
    return {
      keys: rows.map((r) => {
        const jwk = createPublicKey(r.publicKeyPem).export({ format: 'jwk' }) as Record<string, string>;
        return { ...jwk, kid: r.kid, use: 'sig', alg: 'RS256' };
      }),
    };
  }

  // ── launch ─────────────────────────────────────────────────────────────────

  /**
   * Step 1 — OIDC login initiation.
   *
   * Returns where to send the browser. The subject is captured here, from the
   * verified token, and stored on the session; the launch in step 2 reads it
   * back rather than trusting anything that returns from the tool.
   */
  async beginLaunch(courseModuleId: string): Promise<{ redirectUrl: string; state: string }> {
    const { cm, inst } = await this.resolve(courseModuleId);
    if (!inst.loginUrl) throw new BadRequestException('This tool has no OIDC login URL configured');
    if (!inst.clientId) throw new BadRequestException('This tool has no client id configured');

    const principal = this.portalIdentity.principal();
    const state = randomBytes(24).toString('base64url');
    const nonce = randomBytes(24).toString('base64url');

    await this.prisma.client.ltiLaunchSession.create({
      data: {
        organizationId: this.org, courseModuleId, state, nonce,
        userId: principal.kind === 'staff' ? principal.userId : null,
        studentProfileId: principal.kind === 'student' ? principal.studentProfileId : null,
        expiresAt: new Date(Date.now() + SESSION_TTL_MS),
      },
    });

    const params = new URLSearchParams({
      iss: this.issuer,
      login_hint: principal.kind === 'student' ? principal.studentProfileId : principal.userId,
      target_link_uri: inst.toolUrl,
      lti_message_hint: courseModuleId,
      client_id: inst.clientId,
      lti_deployment_id: inst.deploymentId ?? '',
    });
    await this.events.log({
      eventName: 'mod_lti.launch_initiated', component: 'mod_lti', action: 'created', target: 'course_module',
      courseModuleId, courseOfferingId: cm.courseOfferingId,
    });
    return { redirectUrl: `${inst.loginUrl}?${params.toString()}`, state };
  }

  /**
   * Step 2 — the signed launch.
   *
   * Consumes the session (single use), builds the LTI claims and returns a
   * self-submitting form target. The learner's identity comes from the stored
   * session, so a tampered `state` yields no launch rather than someone else's.
   */
  async completeLaunch(state: string): Promise<{ toolUrl: string; idToken: string }> {
    const session = await this.prisma.client.ltiLaunchSession.findFirst({
      where: { organizationId: this.org, state },
    });
    if (!session) throw new NotFoundException('Unknown launch');
    if (session.consumedAt) throw new ForbiddenException('This launch has already been used');
    if (session.expiresAt < new Date()) throw new ForbiddenException('This launch has expired');
    await this.prisma.client.ltiLaunchSession.update({
      where: { id: session.id },
      data: { consumedAt: new Date() },
    });

    const { cm, inst, offering } = await this.resolve(session.courseModuleId);
    const key = await this.activeKey();
    const header = await this.envelope.courseHeader(offering);

    const subject = session.studentProfileId ?? session.userId ?? 'anonymous';
    const roles = session.studentProfileId
      ? ['http://purl.imsglobal.org/vocab/lis/v2/membership#Learner']
      : ['http://purl.imsglobal.org/vocab/lis/v2/membership#Instructor'];

    const claims: Record<string, unknown> = {
      iss: this.issuer,
      aud: inst.clientId,
      sub: subject,
      nonce: session.nonce,
      [`${CLAIM}/message_type`]: MESSAGE_TYPE,
      [`${CLAIM}/version`]: LTI_VERSION,
      [`${CLAIM}/deployment_id`]: inst.deploymentId ?? '',
      [`${CLAIM}/target_link_uri`]: inst.toolUrl,
      [`${CLAIM}/roles`]: roles,
      [`${CLAIM}/resource_link`]: { id: cm.id, title: inst.name },
      [`${CLAIM}/context`]: {
        id: cm.courseOfferingId,
        label: header.subject ?? 'Course',
        title: header.name,
        type: ['http://purl.imsglobal.org/vocab/lis/v2/course#CourseOffering'],
      },
      [`${CLAIM}/custom`]: inst.customParams ?? {},
    };

    // Advertise the grade endpoint only for a gradable activity — a tool told it
    // may post scores to a non-graded link would have nowhere to put them.
    if (inst.gradable && cm.assessmentId) {
      claims[AGS_CLAIM] = {
        scope: [
          'https://purl.imsglobal.org/spec/lti-ags/scope/score',
          'https://purl.imsglobal.org/spec/lti-ags/scope/lineitem.readonly',
        ],
        lineitem: `${this.issuer}/api/v1/school/lms/lti/${cm.id}/lineitem`,
      };
    }

    const idToken = jwt.sign(claims, key.privateKeyPem, {
      algorithm: 'RS256',
      expiresIn: '5m',
      keyid: key.kid,
    });

    await this.events.log({
      eventName: 'mod_lti.launched', component: 'mod_lti', action: 'viewed', target: 'course_module',
      courseModuleId: cm.id, courseOfferingId: cm.courseOfferingId,
      studentProfileId: session.studentProfileId ?? undefined,
    });
    return { toolUrl: inst.toolUrl, idToken };
  }

  // ── AGS grade passback ─────────────────────────────────────────────────────

  /**
   * Accept a score from the tool (Assignment & Grade Services).
   *
   * The score is scaled against the activity's own maximum rather than trusted
   * verbatim: a tool reporting 95/100 for an activity marked out of 20 must land
   * as 19, not 95. Marks are posted through the grade bridge, so
   * `MarkingService` stays the one writer.
   */
  async receiveScore(
    courseModuleId: string,
    dto: { userId: string; scoreGiven?: number; scoreMaximum?: number; activityProgress?: string; gradingProgress?: string },
  ): Promise<{ ok: true; score: number | null }> {
    const { cm, inst } = await this.resolve(courseModuleId);
    if (!cm.assessmentId) throw new BadRequestException('This activity is not gradable');
    if (dto.scoreGiven == null) return { ok: true, score: null };

    // `userId` is the `sub` we issued, which for a learner is their profile id.
    const studentProfileId = dto.userId;
    const exists = await this.prisma.client.studentProfile.findFirst({
      where: { id: studentProfileId, organizationId: this.org },
      select: { id: true },
    });
    if (!exists) throw new BadRequestException('Score is for a user this platform does not recognise');

    const toolMax = Number(dto.scoreMaximum ?? 100) || 100;
    const ourMax = Number(inst.maxScore ?? 100);
    const scaled = Math.round((Number(dto.scoreGiven) / toolMax) * ourMax * 100) / 100;

    const assessment = await this.prisma.client.assessment.findFirst({
      where: { id: cm.assessmentId }, select: { id: true, classId: true, termId: true, maxScore: true },
    });
    const sa = await this.prisma.client.studentAssessment.upsert({
      where: { assessmentId_studentProfileId: { assessmentId: cm.assessmentId, studentProfileId } },
      create: {
        organizationId: this.org, assessmentId: cm.assessmentId, studentProfileId,
        classId: assessment?.classId ?? null, termId: assessment?.termId ?? null,
        maxScore: assessment?.maxScore ?? ourMax,
      },
      update: {},
    });
    await this.prisma.client.$transaction(async (tx: any) =>
      this.grades.setScore({ studentAssessmentId: sa.id, score: scaled, source: 'plugin' }, tx));

    await this.events.log({
      eventName: 'mod_lti.score_received', component: 'mod_lti', action: 'graded', target: 'course_module',
      courseModuleId: cm.id, courseOfferingId: cm.courseOfferingId, studentProfileId,
      other: { scoreGiven: dto.scoreGiven, scoreMaximum: toolMax, scaled },
    });
    return { ok: true, score: scaled };
  }

  /** The AGS line item descriptor for this activity. */
  async lineItem(courseModuleId: string) {
    const { cm, inst } = await this.resolve(courseModuleId);
    return {
      id: `${this.issuer}/api/v1/school/lms/lti/${cm.id}/lineitem`,
      scoreMaximum: Number(inst.maxScore ?? 100),
      label: inst.name,
      resourceLinkId: cm.id,
    };
  }

  // ── internals ──

  private async resolve(courseModuleId: string) {
    const cm = await this.prisma.client.courseModule.findFirst({
      where: { id: courseModuleId, organizationId: this.org, deletedAt: null },
    });
    if (!cm) throw new NotFoundException('Activity not found');
    if (cm.activityType !== 'lti') throw new BadRequestException('This activity is not an external tool');
    const inst = await this.prisma.client.modLti.findFirst({
      where: { id: cm.instanceId, organizationId: this.org },
    });
    if (!inst) throw new NotFoundException('External tool configuration not found');
    const offering = await this.prisma.client.courseOffering.findFirst({
      where: { id: cm.courseOfferingId, organizationId: this.org },
    });
    if (!offering) throw new NotFoundException('Course not found');
    return { cm, inst, offering };
  }
}
