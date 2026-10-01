// Range bounds are datetime-local strings; a set bound excludes rows with no timestamp.
export const inRange = (d: string | null | undefined, from: string, to: string) => {
  if (!from && !to) return true;
  if (!d) return false;
  const t = new Date(d).getTime();
  return (!from || t >= new Date(from).getTime()) && (!to || t <= new Date(to).getTime());
};
