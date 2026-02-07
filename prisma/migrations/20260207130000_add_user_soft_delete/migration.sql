-- Add soft delete to User.
ALTER TABLE "User" ADD COLUMN "deletedAt" TIMESTAMP(3);
