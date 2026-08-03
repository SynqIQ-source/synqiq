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

// GET /appointment/staffappointments. Status has exactly 5 real values,
// confirmed against the sandbox -- see migration
// 20260802120000_trainer_sessions_and_sales.sql's check constraint. Only
// the fields this app actually reads are declared; the real payload has
// more (Resources, AddOns, OnlineDescription, GenderPreference, ProviderId,
// Notes, StaffRequested, FirstAppointment, IsWaitlist, WaitlistEntryId,
// ClientServiceId).
export interface MindbodyAppointment {
  Id: number;
  Status: "Booked" | "Confirmed" | "Arrived" | "Completed" | "NoShow";
  StartDateTime: string;
  EndDateTime: string | null;
  Duration: number | null;
  StaffId: number;
  ClientId: string | null;
  SessionTypeId: number | null;
  LocationId: number | null;
}

// GET /sale/sales. SalesRepId is sale-level only (never per line item) and
// nullable -- confirmed ~7.75% populated in the sandbox. total_amount at
// sync time is computed as the sum of PurchasedItems[].TotalAmount, not
// carried as its own field here (the real payload has no sale-level total).
export interface MindbodySale {
  Id: number;
  SaleDateTime: string;
  SalesRepId: number | null;
  ClientId: string | null;
  PurchasedItems: Array<{
    TotalAmount: number | null;
  }> | null;
}
