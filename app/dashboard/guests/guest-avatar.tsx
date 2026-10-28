import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";

export function GuestAvatar({
  url,
  firstName,
  lastName,
  className,
}: {
  url: string | null;
  firstName: string;
  lastName: string;
  className?: string;
}) {
  return (
    <Avatar className={cn("h-10 w-10", className)}>
      {url ? <AvatarImage src={url} alt="" className="object-cover" /> : null}
      <AvatarFallback>
        {firstName.charAt(0).toUpperCase()}
        {lastName.charAt(0).toUpperCase()}
      </AvatarFallback>
    </Avatar>
  );
}
