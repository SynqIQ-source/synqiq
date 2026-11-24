import { redirect } from "next/navigation";

// Trainer session rates are set on Pay Rates (the session rate each person is
// assigned). The pilot still honours any dated rates already saved, but new
// ones aren't added here any more.
export default function TrainerRatesPage() {
  redirect("/dashboard/pay-rates");
}
