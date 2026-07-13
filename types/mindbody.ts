import type { MindbodyOccurrenceId, MindbodyScheduleId } from "@/lib/mindbody/types";

export interface MindbodyClass {
  Id: MindbodyOccurrenceId;
  ClassScheduleId: MindbodyScheduleId;
  StartDateTime: string;
  EndDateTime: string;
  LastModifiedDateTime: string;
  MaxCapacity: number;
  WebCapacity: number;
  TotalBooked: number;
  TotalSignedIn: number;
  Location: {
    Id: number;
    Name: string;
  };
  Staff: {
    Id: number;
    Name: string | null;
    FirstName: string;
    DisplayName: string;
  };
  ClassDescription: {
    Id: number;
    Name: string;
  };
}

export interface MindbodySite {
  Id: number;
  Name: string;
  /** IANA timezone name, e.g. "America/Chicago". */
  TimeZone: string;
}
