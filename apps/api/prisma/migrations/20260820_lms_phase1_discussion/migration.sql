-- LMS Phase 1: Discussion <-> DiscussionPost relation FK.
ALTER TABLE "DiscussionPost"
  ADD CONSTRAINT "DiscussionPost_discussionId_fkey" FOREIGN KEY ("discussionId") REFERENCES "Discussion"("id") ON DELETE CASCADE ON UPDATE CASCADE;
