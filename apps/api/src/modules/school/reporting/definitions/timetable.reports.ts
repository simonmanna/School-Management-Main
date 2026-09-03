import { PERMISSIONS } from '@erp/shared';
import type { ReportDefinition } from '../../../core/reporting/report.types';
import type { SchoolReportDeps } from '../school-report-deps';

/**
 * Timetable-domain reports.
 *
 * Reads from TimetableAdvancedService which builds class grids with override
 * overlays. The grid structure is day × period; we flatten it for the table
 * renderer. A master timetable is the union of all class grids.
 */
/**
 * Attach the subject an override names.
 *
 * `TimetableOverride` carries loose `subjectId` / `teacherPartnerId` columns and
 * declares no Prisma relations, so `include: { subject: true, ... }` made the
 * query invalid — and the cells built from those overrides read `.subject.name`,
 * which could never have been populated. Resolve the ids explicitly instead.
 */
export function timetableReports(deps: SchoolReportDeps): ReportDefinition<any>[] {
  return [
    {
      key: 'timetable.class',
      title: 'Class Timetable',
      domain: 'timetable',
      description: 'Weekly grid for one class (optionally section), with overrides applied.',
      permission: PERMISSIONS.school.readReports,
      shape: 'table',
      filters: ['classId', 'sectionId', 'termId', 'dateFrom'],
      requiredFilters: ['classId'],
      classBasisDefault: 'current',
      asOfMode: 'live',
      paging: 'memory',
      defaultSort: { key: 'dayOfWeek', order: 'asc' },
      columns: [
        // A timetable read in alphabetical day order starts on Friday. The sort
        // is therefore on the numeric day, which must be a declared column —
        // a sort key that is not a column sorts by nothing — and is hidden
        // because the reader wants 'Monday', not '1'.
        { key: 'dayOfWeek', label: 'Day order', type: 'int', width: 6, hideOn: ['screen', 'csv', 'xlsx', 'pdf'] },
        { key: 'dayName', label: 'Day', type: 'string', width: 12 },
        { key: 'periodOrder', label: 'Period', type: 'int', width: 8 },
        { key: 'periodName', label: 'Period Name', type: 'string', width: 14 },
        { key: 'startTime', label: 'Start', type: 'datetime', width: 10 },
        { key: 'endTime', label: 'End', type: 'datetime', width: 10 },
        { key: 'subjectName', label: 'Subject', type: 'string', width: 18 },
        { key: 'teacherName', label: 'Teacher', type: 'string', width: 20 },
        { key: 'roomName', label: 'Room', type: 'string', width: 12 },
        { key: 'overridden', label: 'Override', type: 'bool', width: 8 },
        { key: 'overrideReason', label: 'Reason', type: 'string', width: 18 },
      ],
      async run(ctx, params) {
        const classId = params.classId;
        const sectionId = params.sectionId ?? null;
        const date = params.dateFrom;

        const { grid, slots } = await deps.timetable.classGridWithOverrides(classId, sectionId, date);

        const rows: any[] = [];
        const dayNames = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
        const gridMap = grid as Record<string, any>;

        for (const dayOfWeek of Object.keys(gridMap).sort((a, b) => Number(a) - Number(b))) {
          const dayGrid = gridMap[dayOfWeek];
          for (const periodId of Object.keys(dayGrid).sort()) {
            const cell = dayGrid[periodId];
            const slot = (slots as any[]).find(s => s.dayOfWeek === Number(dayOfWeek) && s.periodId === periodId);
            rows.push({
              dayOfWeek: Number(dayOfWeek),
              dayName: dayNames[Number(dayOfWeek) - 1] ?? `Day ${dayOfWeek}`,
              periodOrder: slot?.period?.order ?? 0,
              periodName: slot?.period?.name ?? periodId,
              startTime: slot?.period?.startTime ?? '',
              endTime: slot?.period?.endTime ?? '',
              subjectName: cell?.subject?.name ?? '',
              teacherName: cell?.teacher?.partner?.name ?? '',
              roomName: cell?.teachingRoom?.name ?? cell?.room ?? '',
              overridden: cell?.overridden ?? false,
              overrideReason: cell?.overrideReason ?? '',
            });
          }
        }

        const classInfo = await deps.lookup.classById(classId);

        return {
          rows,
          caption: `${classInfo?.name ?? classId} ${sectionId ? `· ${sectionId}` : ''} · ${date ? `for ${date}` : 'current grid'}`,
          notes: slots.overrides > 0 ? [`${slots.overrides} override(s) applied`] : [],
        };
      },
    },

    {
      key: 'timetable.teacher',
      title: 'Teacher Timetable',
      domain: 'timetable',
      description: 'Weekly schedule for one teacher across all their classes.',
      permission: PERMISSIONS.school.readReports,
      shape: 'table',
      filters: ['staffProfileId', 'termId', 'dateFrom'],
      requiredFilters: ['staffProfileId'],
      classBasisDefault: 'current',
      asOfMode: 'live',
      paging: 'memory',
      defaultSort: { key: 'dayOfWeek', order: 'asc' },
      columns: [
        // A timetable read in alphabetical day order starts on Friday. The sort
        // is therefore on the numeric day, which must be a declared column —
        // a sort key that is not a column sorts by nothing — and is hidden
        // because the reader wants 'Monday', not '1'.
        { key: 'dayOfWeek', label: 'Day order', type: 'int', width: 6, hideOn: ['screen', 'csv', 'xlsx', 'pdf'] },
        { key: 'dayName', label: 'Day', type: 'string', width: 12 },
        { key: 'periodOrder', label: 'Period', type: 'int', width: 8 },
        { key: 'periodName', label: 'Period Name', type: 'string', width: 14 },
        { key: 'startTime', label: 'Start', type: 'datetime', width: 10 },
        { key: 'endTime', label: 'End', type: 'datetime', width: 10 },
        { key: 'className', label: 'Class', type: 'string', width: 14 },
        { key: 'sectionName', label: 'Section', type: 'string', width: 10 },
        { key: 'subjectName', label: 'Subject', type: 'string', width: 18 },
        { key: 'roomName', label: 'Room', type: 'string', width: 12 },
        { key: 'overridden', label: 'Override', type: 'bool', width: 8 },
      ],
      async run(ctx, params) {
        const teacherPartnerId = params.staffProfileId;
        const date = params.dateFrom;

        // Get all slots where this teacher is assigned
        const slots = await deps.lookup.timetableSlotsDetailed({ teacherPartnerId });

        let overrides: any[] = [];
        if (date) {
          const d = new Date(date);
          overrides = await deps.lookup.timetableOverridesOn({ on: d, teacherPartnerId });
        }

        const overrideMap = new Map<string, any>();
        for (const o of overrides) {
          overrideMap.set(`${o.dayOfWeek}|${o.periodId}|${o.classId}|${o.sectionId ?? ''}`, o);
        }

        const dayNames = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
        const rows: any[] = [];

        for (const slot of slots) {
          const key = `${slot.dayOfWeek}|${slot.periodId}|${slot.classId}|${slot.sectionId ?? ''}`;
          const override = overrideMap.get(key);
          const cell = override ?? slot;

          rows.push({
            dayOfWeek: slot.dayOfWeek,
            dayName: dayNames[slot.dayOfWeek - 1] ?? `Day ${slot.dayOfWeek}`,
            periodOrder: slot.period?.order ?? 0,
            periodName: slot.period?.name ?? slot.periodId,
            startTime: slot.period?.startTime ?? '',
            endTime: slot.period?.endTime ?? '',
            className: slot.schoolClass?.name ?? '',
            sectionName: slot.section?.name ?? '',
            subjectName: cell?.subject?.name ?? '',
            roomName: cell?.teachingRoom?.name ?? cell?.room ?? '',
            overridden: !!override,
            overrideReason: override?.reason ?? '',
          });
        }

        return {
          rows,
          caption: `Teacher ${teacherPartnerId} · ${date ? `for ${date}` : 'current grid'}`,
          notes: overrides.length > 0 ? [`${overrides.length} override(s) applied`] : [],
        };
      },
    },

    {
      key: 'timetable.master',
      title: 'Master Timetable',
      domain: 'timetable',
      description: 'All classes × periods grid — detects clashes and shows room utilisation.',
      permission: PERMISSIONS.school.readReports,
      alsoRequires: [PERMISSIONS.school.readAnalytics],
      shape: 'table',
      filters: ['campusId', 'gradeLevelId', 'termId', 'dateFrom'],
      classBasisDefault: 'current',
      asOfMode: 'live',
      paging: 'memory',
      defaultSort: { key: 'dayOfWeek', order: 'asc' },
      columns: [
        // See the note on the class timetable above: the sort is on the numeric
        // day, hidden from the reader.
        { key: 'dayOfWeek', label: 'Day order', type: 'int', width: 6, hideOn: ['screen', 'csv', 'xlsx', 'pdf'] },
        { key: 'dayName', label: 'Day', type: 'string', width: 10 },
        { key: 'periodOrder', label: 'Period', type: 'int', width: 8 },
        { key: 'periodName', label: 'Period', type: 'string', width: 12 },
        { key: 'startTime', label: 'Start', type: 'datetime', width: 10 },
        { key: 'endTime', label: 'End', type: 'datetime', width: 10 },
        { key: 'className', label: 'Class', type: 'string', width: 14 },
        { key: 'sectionName', label: 'Section', type: 'string', width: 10 },
        { key: 'subjectName', label: 'Subject', type: 'string', width: 18 },
        { key: 'teacherName', label: 'Teacher', type: 'string', width: 20 },
        { key: 'roomName', label: 'Room', type: 'string', width: 12 },
        { key: 'clash', label: 'Clash', type: 'bool', width: 8 },
        { key: 'clashDetails', label: 'Details', type: 'string', width: 22 },
      ],
      async run(ctx, params) {
        const date = params.dateFrom;
        const classIds = ctx.resolved.classIds;

        // Get all slots for the filtered classes
        const slots = await deps.lookup.timetableSlotsDetailed({ classIds });

        let overrides: any[] = [];
        if (date) {
          const d = new Date(date);
          overrides = await deps.lookup.timetableOverridesOn({ on: d, classIds });
        }

        // Build a lookup for the effective cell (override wins)
        const cellKey = (s: any) => `${s.dayOfWeek}|${s.periodId}|${s.classId}|${s.sectionId ?? ''}`;
        const effective = new Map<string, any>();
        for (const s of slots) effective.set(cellKey(s), s);
        for (const o of overrides) effective.set(cellKey(o), { ...effective.get(cellKey(o)), ...o, overridden: true });

        // Detect clashes: same teacher or same room in same period
        const byTeacherPeriod = new Map<string, any[]>();
        const byRoomPeriod = new Map<string, any[]>();
        for (const cell of effective.values()) {
          if (cell.teacherPartnerId) {
            const tpKey = `${cell.teacherPartnerId}|${cell.dayOfWeek}|${cell.periodId}`;
            const arr = byTeacherPeriod.get(tpKey) ?? [];
            arr.push(cell);
            byTeacherPeriod.set(tpKey, arr);
          }
          if (cell.teachingRoomId) {
            const rpKey = `${cell.teachingRoomId}|${cell.dayOfWeek}|${cell.periodId}`;
            const arr = byRoomPeriod.get(rpKey) ?? [];
            arr.push(cell);
            byRoomPeriod.set(rpKey, arr);
          }
        }

        const dayNames = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
        const rows: any[] = [];

        for (const cell of effective.values()) {
          const tpKey = `${cell.teacherPartnerId}|${cell.dayOfWeek}|${cell.periodId}`;
          const rpKey = `${cell.teachingRoomId}|${cell.dayOfWeek}|${cell.periodId}`;
          const teacherClash = cell.teacherPartnerId && (byTeacherPeriod.get(tpKey)?.length ?? 0) > 1;
          const roomClash = cell.teachingRoomId && (byRoomPeriod.get(rpKey)?.length ?? 0) > 1;
          const hasClash = teacherClash || roomClash;

          let details = '';
          if (teacherClash) {
            const others = byTeacherPeriod.get(tpKey)!.filter(c => c.classId !== cell.classId);
            details += `Teacher in ${others.map((o: any) => o.schoolClass?.name).join(', ')}; `;
          }
          if (roomClash) {
            const others = byRoomPeriod.get(rpKey)!.filter(c => c.classId !== cell.classId);
            details += `Room used by ${others.map((o: any) => o.schoolClass?.name).join(', ')}; `;
          }

          rows.push({
            dayOfWeek: cell.dayOfWeek,
            dayName: dayNames[cell.dayOfWeek - 1] ?? `Day ${cell.dayOfWeek}`,
            periodOrder: cell.period?.order ?? 0,
            periodName: cell.period?.name ?? cell.periodId,
            startTime: cell.period?.startTime ?? '',
            endTime: cell.period?.endTime ?? '',
            className: cell.schoolClass?.name ?? '',
            sectionName: cell.section?.name ?? '',
            subjectName: cell.subject?.name ?? '',
            teacherName: cell.teacher?.partner?.name ?? '',
            roomName: cell.teachingRoom?.name ?? cell.room ?? '',
            clash: hasClash,
            clashDetails: details.slice(0, -2),
          });
        }

        const clashCount = rows.filter(r => r.clash).length;
        return {
          rows,
          caption: `Master timetable · ${classIds?.length ?? 0} class(es) · ${date ? `for ${date}` : 'current grid'}`,
          notes: clashCount > 0 ? [`${clashCount} clash(es) detected — review before publishing`] : [],
        };
      },
    },

    {
      key: 'timetable.room-utilisation',
      title: 'Room Utilisation',
      domain: 'timetable',
      description: 'How often each teaching room is booked across the week.',
      permission: PERMISSIONS.school.readReports,
      shape: 'table',
      filters: ['campusId', 'termId', 'dateFrom'],
      classBasisDefault: 'current',
      asOfMode: 'live',
      paging: 'memory',
      defaultSort: { key: 'utilisationPct', order: 'desc' },
      columns: [
        { key: 'roomName', label: 'Room', type: 'string', width: 18 },
        { key: 'capacity', label: 'Capacity', type: 'int', width: 10 },
        { key: 'totalSlots', label: 'Total Periods', type: 'int', width: 12 },
        { key: 'bookedSlots', label: 'Booked', type: 'int', width: 10 },
        { key: 'utilisationPct', label: 'Utilisation', type: 'percent', width: 12 },
        { key: 'periods', label: 'Periods Used', type: 'string', width: 40 },
      ],
      async run(ctx, params) {
        const date = params.dateFrom;
        const classIds = ctx.resolved.classIds;

        // Get all rooms
        const rooms = await (deps.timetable as any).listRooms();
        const roomIds = rooms.map((r: any) => r.id);

        // Get all slots for classes
        const slots = await deps.lookup.timetableSlotsForRooms({ classIds });

        let overrides: any[] = [];
        if (date) {
          const d = new Date(date);
          overrides = await deps.lookup.timetableOverridesOn({ on: d, classIds });
        }

        const effectiveRoomSlots = new Map<string, Set<string>>();
        for (const s of slots) {
          if (s.teachingRoomId) {
            const key = `${s.teachingRoomId}|${s.dayOfWeek}|${s.periodId}`;
            const set = effectiveRoomSlots.get(key) ?? new Set();
            set.add(`${s.classId}|${s.sectionId ?? ''}`);
            effectiveRoomSlots.set(key, set);
          }
        }
        for (const o of overrides) {
          if (o.teachingRoomId) {
            const key = `${o.teachingRoomId}|${o.dayOfWeek}|${o.periodId}`;
            effectiveRoomSlots.set(key, new Set([`${o.classId}|${o.sectionId ?? ''}`]));
          }
        }

        // Periods in the cycle
        const periods = await deps.lookup.periods();
        const days = 7;
        const totalPeriodsPerWeek = periods.length * days;

        const rows = rooms.map((room: any) => {
          let booked = 0;
          const periodLabels: string[] = [];
          for (let day = 1; day <= days; day++) {
            for (const p of periods) {
              const key = `${room.id}|${day}|${p.id}`;
              if (effectiveRoomSlots.has(key)) {
                booked++;
                periodLabels.push(`${['Mon','Tue','Wed','Thu','Fri','Sat','Sun'][day-1]} ${p.name}`);
              }
            }
          }
          return {
            roomName: room.name,
            capacity: room.capacity ?? 0,
            totalSlots: totalPeriodsPerWeek,
            bookedSlots: booked,
            utilisationPct: totalPeriodsPerWeek > 0 ? (booked / totalPeriodsPerWeek) * 100 : 0,
            periods: periodLabels.join(', '),
          };
        });

        return {
          rows,
          caption: `${rooms.length} room(s) · ${date ? `for ${date}` : 'current grid'}`,
        };
      },
    },
  ];
}