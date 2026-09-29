/**
 * Wave 16 — the library fine per overdue day is the school's setting
 * (SchoolProfile.customFields.libraryFinePerDay), UGX 200 when unset, and 0
 * is honoured for a school that does not fine.
 */
import { BookMetadataService } from '../../src/modules/school/library/library-transport-hostel-cafeteria.service';

function make(customFields: Record<string, unknown> | null) {
  const dueAt = new Date(Date.now() - 3 * 86_400_000 + 60_000); // 3 days overdue (ceil)
  const client: any = {
    bookMetadata: {},
    borrowing: { findMany: jest.fn().mockResolvedValue([{ id: 'b1', dueAt, studentProfileId: 's1' }]) },
    schoolProfile: { findFirst: jest.fn().mockResolvedValue(customFields ? { customFields } : null) },
  };
  return new BookMetadataService({ client } as any, { organizationId: 'org' } as any);
}

describe('library fine rate', () => {
  it('defaults to UGX 200 a day', async () => {
    const [row] = await make(null).getOverdue();
    expect(row.daysOverdue).toBe(3);
    expect(row.fineAmount).toBe(600);
  });

  it("uses the school's rate", async () => {
    const [row] = await make({ libraryFinePerDay: 500 }).getOverdue();
    expect(row.fineAmount).toBe(1500);
  });

  it('honours zero', async () => {
    const [row] = await make({ libraryFinePerDay: 0 }).getOverdue();
    expect(row.fineAmount).toBe(0);
  });

  it('ignores a nonsense value', async () => {
    const [row] = await make({ libraryFinePerDay: 'lots' }).getOverdue();
    expect(row.fineAmount).toBe(600);
  });
});
