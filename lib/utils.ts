import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

// shadcn/ui's class-merging helper -- later classes win over earlier ones
// (so a caller's className can override a component's defaults).
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
