import { Body, Controller, Get, Param, Post, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { PERMISSIONS } from '@erp/shared';
import { RequirePermissions } from '../../../../../kernel/auth/decorators/require-permissions.decorator';
import { Public } from '../../../../../kernel/auth/decorators/public.decorator';
import { LtiService } from './lti.service';

/**
 * LTI 1.3 platform endpoints (L8).
 *
 * `jwks` and the AGS score sink are `@Public` by necessity: they are called by
 * the external tool's server, which holds no session with us. Both are safe to
 * expose — JWKS publishes only public keys, and a score is bound to the
 * `resourceLinkId` in the path and re-scaled against that activity's own
 * maximum before it reaches the spine.
 */
@Controller('school/lms/lti')
export class LtiController {
  constructor(private readonly lti: LtiService) {}

  /** Public keys tools verify our launches against. */
  @Public()
  @Get('.well-known/jwks.json')
  jwks() {
    return this.lti.jwks();
  }

  /** Step 1: where to send the browser to start the OIDC handshake. */
  @Post(':id/launch/begin')
  @RequirePermissions(PERMISSIONS.school.lmsRead)
  begin(@Param('id') id: string) {
    return this.lti.beginLaunch(id);
  }

  /**
   * Step 2: the signed launch, delivered as a self-submitting form because LTI
   * requires the id_token to reach the tool as an HTTP POST from the browser.
   */
  @Get('launch')
  @RequirePermissions(PERMISSIONS.school.lmsRead)
  async launch(@Query('state') state: string, @Res() res: Response) {
    const { toolUrl, idToken } = await this.lti.completeLaunch(state);
    const esc = (v: string) => v.replace(/[&<>"']/g, (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    res.send(
      `<!doctype html><html><body onload="document.forms[0].submit()">` +
        `<form method="POST" action="${esc(toolUrl)}">` +
        `<input type="hidden" name="id_token" value="${esc(idToken)}"/>` +
        `<input type="hidden" name="state" value="${esc(state)}"/>` +
        `<noscript><button type="submit">Continue to the tool</button></noscript>` +
        `</form></body></html>`,
    );
  }

  /** AGS line item descriptor for this activity. */
  @Public()
  @Get(':id/lineitem')
  lineItem(@Param('id') id: string) {
    return this.lti.lineItem(id);
  }

  /** AGS score sink — the tool posts a learner's result back here. */
  @Public()
  @Post(':id/scores')
  scores(@Param('id') id: string, @Body() dto: any) {
    return this.lti.receiveScore(id, dto);
  }

  /** Rotate the signing key. Retires the previous one without deleting it. */
  @Post('keys/rotate')
  @RequirePermissions(PERMISSIONS.school.manageCourses)
  async rotate() {
    const { kid, publicKeyPem } = await this.lti.rotateKey();
    return { kid, publicKeyPem };
  }
}
