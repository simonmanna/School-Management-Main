import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { ModForumPlugin } from '../../src/modules/school/lms/moodle/plugins/adapters.plugins';
import { CAP } from '../../src/modules/school/lms/moodle/capabilities';

/**
 * mod_forum moderation.
 *
 * The rule this suite defends: **moderation verbs arrive on the same route as
 * `reply`.** `POST modules/:id/action/:action` is guarded once, with
 * `activityView`, which every enrolled learner holds — so a verb that locks a
 * thread or deletes a post must re-check `mod/forum:manage` itself against the
 * capability set the spine resolved. Without that, adding these actions would
 * have handed every pupil in the course a moderation button.
 *
 * The second rule: a moderation target is scoped to THIS forum. The capability
 * was resolved against this activity's course, so a thread belonging to another
 * course must not be reachable by passing its id.
 */

const CM = { id: 'cm_1', courseOfferingId: 'co_1', activityType: 'forum' } as any;

function build(opts: {
  capabilities?: Record<string, boolean>;
  userId?: string;
  discussions?: any[];
  posts?: any[];
} = {}) {
  const {
    capabilities = {},
    userId = 'user_teacher',
    discussions = [{ id: 'd_1', courseModuleId: 'cm_1', organizationId: 'org_1', locked: false, pinned: false, deletedAt: null }],
    posts = [],
  } = opts;

  const discussionUpdates: any[] = [];
  const postDeletes: any[] = [];
  const reparents: any[] = [];

  const db: Record<string, any> = {
    modForum: { findFirst: jest.fn(async () => ({ id: 'inst_1', name: 'Class forum' })) },
    discussion: {
      // Honour the where clause: a fallback to discussions[0] would make the
      // "another course's thread" case look like a hit and hide the real rule.
      findFirst: jest.fn(async (a: any) => {
        const w = a.where ?? {};
        return (
          discussions.find(
            (d) =>
              (w.id === undefined || d.id === w.id) &&
              (w.courseModuleId === undefined || d.courseModuleId === w.courseModuleId) &&
              (w.deletedAt === undefined || d.deletedAt === w.deletedAt),
          ) ?? null
        );
      }),
      findMany: jest.fn(async () => discussions),
      update: jest.fn(async (a: any) => {
        discussionUpdates.push(a);
        return { ...discussions[0], ...a.data };
      }),
    },
    discussionPost: {
      findFirst: jest.fn(async (a: any) => {
        const w = a.where ?? {};
        return posts.find((p) => w.id === undefined || p.id === w.id) ?? null;
      }),
      create: jest.fn(async (a: any) => ({ id: 'p_new', ...a.data })),
      delete: jest.fn(async (a: any) => {
        postDeletes.push(a);
        return {};
      }),
      updateMany: jest.fn(async (a: any) => {
        reparents.push(a);
        return { count: 1 };
      }),
      count: jest.fn(async () => 0),
    },
  };

  const prisma = { client: db } as any;
  const plugin = new ModForumPlugin(prisma, { organizationId: 'org_1' } as any, {
    register: jest.fn(),
  } as any);

  const ctx = { organizationId: 'org_1', userId, capabilities } as any;
  return { plugin, ctx, db, discussionUpdates, postDeletes, reparents };
}

const MANAGER = { [CAP.forumManage]: true };
/** What an ordinary enrolled pupil holds on the action route. */
const LEARNER = { [CAP.activityView]: true, [CAP.forumReplyPost]: true };

describe('mod_forum moderation', () => {
  describe('refuses a caller without mod/forum:manage', () => {
    for (const action of ['lock', 'unlock', 'pin', 'unpin', 'deleteDiscussion']) {
      it(`refuses '${action}' for a learner`, async () => {
        const { plugin, ctx } = build({ capabilities: LEARNER, userId: 'user_pupil' });
        await expect(
          plugin.action(ctx, CM, action, { discussionId: 'd_1' }),
        ).rejects.toThrow(ForbiddenException);
      });
    }

    it('refuses deleting a post that is not yours', async () => {
      const { plugin, ctx } = build({
        capabilities: LEARNER,
        userId: 'user_pupil',
        posts: [{ id: 'p_1', authorId: 'user_someone_else', parentPostId: null, discussion: { courseModuleId: 'cm_1' } }],
      });
      await expect(plugin.action(ctx, CM, 'deletePost', { postId: 'p_1' })).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('refuses when the capability set is absent entirely', async () => {
      const { plugin } = build();
      const ctx = { organizationId: 'org_1', userId: 'user_pupil' } as any; // no capabilities
      await expect(plugin.action(ctx, CM, 'lock', { discussionId: 'd_1' })).rejects.toThrow(
        ForbiddenException,
      );
    });
  });

  describe('allows a moderator', () => {
    it('locks a thread', async () => {
      const { plugin, ctx, discussionUpdates } = build({ capabilities: MANAGER });
      await plugin.action(ctx, CM, 'lock', { discussionId: 'd_1' });
      expect(discussionUpdates[0].data).toEqual({ locked: true });
    });

    it('unlocks a thread', async () => {
      const { plugin, ctx, discussionUpdates } = build({ capabilities: MANAGER });
      await plugin.action(ctx, CM, 'unlock', { discussionId: 'd_1' });
      expect(discussionUpdates[0].data).toEqual({ locked: false });
    });

    it('pins and unpins', async () => {
      const { plugin, ctx, discussionUpdates } = build({ capabilities: MANAGER });
      await plugin.action(ctx, CM, 'pin', { discussionId: 'd_1' });
      await plugin.action(ctx, CM, 'unpin', { discussionId: 'd_1' });
      expect(discussionUpdates.map((u) => u.data)).toEqual([{ pinned: true }, { pinned: false }]);
    });

    it('soft-deletes a thread, so a head teacher can still see it', async () => {
      const { plugin, ctx, discussionUpdates } = build({ capabilities: MANAGER });
      await plugin.action(ctx, CM, 'deleteDiscussion', { discussionId: 'd_1' });
      expect(discussionUpdates[0].data.deletedAt).toBeInstanceOf(Date);
    });

    it('deletes any post', async () => {
      const { plugin, ctx, postDeletes } = build({
        capabilities: MANAGER,
        posts: [{ id: 'p_1', authorId: 'user_pupil', parentPostId: null, discussion: { courseModuleId: 'cm_1' } }],
      });
      await plugin.action(ctx, CM, 'deletePost', { postId: 'p_1' });
      expect(postDeletes[0].where).toEqual({ id: 'p_1' });
    });
  });

  describe('an author may retract their own post', () => {
    it('allows it without the moderation capability', async () => {
      const { plugin, ctx, postDeletes } = build({
        capabilities: LEARNER,
        userId: 'user_pupil',
        posts: [{ id: 'p_1', authorId: 'user_pupil', parentPostId: null, discussion: { courseModuleId: 'cm_1' } }],
      });
      await plugin.action(ctx, CM, 'deletePost', { postId: 'p_1' });
      expect(postDeletes[0].where).toEqual({ id: 'p_1' });
    });

    it('re-parents the replies rather than orphaning them', async () => {
      const { plugin, ctx, reparents } = build({
        capabilities: MANAGER,
        posts: [{ id: 'p_2', authorId: 'u', parentPostId: 'p_root', discussion: { courseModuleId: 'cm_1' } }],
      });
      await plugin.action(ctx, CM, 'deletePost', { postId: 'p_2' });
      expect(reparents[0].where).toEqual({ parentPostId: 'p_2' });
      expect(reparents[0].data).toEqual({ parentPostId: 'p_root' });
    });
  });

  describe('scoping', () => {
    it('will not moderate a thread from another forum', async () => {
      const { plugin, ctx } = build({
        capabilities: MANAGER,
        discussions: [
          { id: 'd_other', courseModuleId: 'cm_OTHER', organizationId: 'org_1', deletedAt: null },
        ],
      });
      await expect(plugin.action(ctx, CM, 'lock', { discussionId: 'd_other' })).rejects.toThrow(
        NotFoundException,
      );
    });

    it('will not delete a post from another forum', async () => {
      const { plugin, ctx } = build({
        capabilities: MANAGER,
        posts: [{ id: 'p_x', authorId: 'u', parentPostId: null, discussion: { courseModuleId: 'cm_OTHER' } }],
      });
      await expect(plugin.action(ctx, CM, 'deletePost', { postId: 'p_x' })).rejects.toThrow(
        NotFoundException,
      );
    });

    it('will not touch an already-deleted thread', async () => {
      const { plugin, ctx } = build({
        capabilities: MANAGER,
        discussions: [
          { id: 'd_1', courseModuleId: 'cm_1', organizationId: 'org_1', deletedAt: new Date() },
        ],
      });
      await expect(plugin.action(ctx, CM, 'lock', { discussionId: 'd_1' })).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('argument checking', () => {
    it('says what is missing when no discussion is named', async () => {
      const { plugin, ctx } = build({ capabilities: MANAGER });
      await expect(plugin.action(ctx, CM, 'lock', {})).rejects.toThrow(BadRequestException);
    });

    it('says what is missing when no post is named', async () => {
      const { plugin, ctx } = build({ capabilities: MANAGER });
      await expect(plugin.action(ctx, CM, 'deletePost', {})).rejects.toThrow(BadRequestException);
    });

    it('still rejects an unknown action', async () => {
      const { plugin, ctx } = build({ capabilities: MANAGER });
      await expect(plugin.action(ctx, CM, 'nonsense', {})).rejects.toThrow(/Unknown mod_forum action/);
    });
  });

  describe('participation is unchanged', () => {
    it('a learner may still reply to an open thread', async () => {
      const { plugin, ctx, db } = build({ capabilities: LEARNER, userId: 'user_pupil' });
      await plugin.action(ctx, CM, 'reply', { discussionId: 'd_1', body: 'We share food' });
      expect(db.discussionPost.create).toHaveBeenCalled();
    });

    it('a locked thread still refuses a reply', async () => {
      const { plugin, ctx } = build({
        capabilities: LEARNER,
        userId: 'user_pupil',
        discussions: [{ id: 'd_1', courseModuleId: 'cm_1', organizationId: 'org_1', locked: true, deletedAt: null }],
      });
      await expect(
        plugin.action(ctx, CM, 'reply', { discussionId: 'd_1', body: 'hi' }),
      ).rejects.toThrow(/locked/i);
    });
  });
});
