declare const occurrenceIdBrand: unique symbol;
declare const scheduleIdBrand: unique symbol;

/** MindBody's per-occurrence class instance id (GET /class/classes[].Id). Unique per occurrence. */
export type MindbodyOccurrenceId = number & { readonly [occurrenceIdBrand]: true };

/** MindBody's recurring series id (GET /class/classes[].ClassScheduleId). Shared by every occurrence of a series. */
export type MindbodyScheduleId = number & { readonly [scheduleIdBrand]: true };

export function asOccurrenceId(id: number): MindbodyOccurrenceId {
  return id as MindbodyOccurrenceId;
}

export function asScheduleId(id: number): MindbodyScheduleId {
  return id as MindbodyScheduleId;
}
