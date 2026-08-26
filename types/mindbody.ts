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

// GET /client/clients. UniqueId (not Id, which is a formatted string of the
// same value here but not always -- see MindbodyClassVisit) is the stable
// per-site identifier used everywhere else in this app.
//
// Active is intentionally NOT declared here -- confirmed empirically
// (sampled 2,000 real clients) that it's `true` for every client regardless
// of real membership status, so it doesn't mean what it sounds like. Status
// is the real signal: observed values are Active, Non-Member, Expired,
// Terminated, Suspended, Declined.
export interface MindbodyClientRecord {
  UniqueId: number;
  FirstName: string;
  LastName: string;
  Status: string;
  IsProspect: boolean;
  CreationDate: string | null;
}

export interface MindbodyClientsResponse {
  PaginationResponse: {
    RequestedLimit: number;
    RequestedOffset: number;
    PageSize: number;
    TotalResults: number;
  };
  Clients: MindbodyClientRecord[] | null;
}

// GET /class/classvisits. ClientUniqueId, not ClientId -- confirmed
// empirically against a real class's visits that the two are NOT
// interchangeable (a check-in method other than staff lookup, e.g. a
// membership barcode scan, produces a ClientId that doesn't match this
// client's actual UniqueId at all; ClientUniqueId is consistent everywhere).
export interface MindbodyClassVisit {
  ClientUniqueId: number;
  SignedIn: boolean;
}

export interface MindbodyClassVisitsResponse {
  Class: {
    Visits: MindbodyClassVisit[] | null;
  } | null;
}
