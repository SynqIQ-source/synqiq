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
  Resource: {
    Id: number;
    Name: string;
  } | null;
  Staff: {
    Id: number;
    Name: string | null;
    FirstName: string;
    DisplayName: string;
  };
  ClassDescription: {
    Id: number;
    Name: string;
    Program: {
      Id: number;
      Name: string;
    } | null;
  };
}

export interface MindbodySite {
  Id: number;
  Name: string;
  /** IANA timezone name, e.g. "America/Chicago". */
  TimeZone: string;
}

export interface MindbodyLocation {
  Id: number;
  Name: string;
  HasClasses: boolean;
}

export interface MindbodyResource {
  Id: number;
  Name: string;
}

export interface MindbodyClassDescription {
  Id: number;
  Name: string;
  Program: {
    Id: number;
    Name: string;
  } | null;
}

export interface MindbodyStaffMember {
  Id: number;
  FirstName: string | null;
  LastName: string | null;
  DisplayName: string | null;
  Name: string | null;
  Email: string | null;
  MobilePhone: string | null;
  HomePhone: string | null;
  WorkPhone: string | null;
  EmploymentStart: string | null;
  EmploymentEnd: string | null;
}
