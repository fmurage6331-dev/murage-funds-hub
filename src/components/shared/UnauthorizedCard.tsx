import { Link } from "@tanstack/react-router";
import { Lock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

type UnauthorizedCardProps = {
  /** Short explanation of why the current role cannot see this page. */
  message: string;
};

/**
 * Centred notice shown in place of a page the signed-in role may not open.
 * Route-level guards render this instead of leaking restricted data.
 */
export function UnauthorizedCard({ message }: UnauthorizedCardProps) {
  return (
    <div className="flex min-h-[60vh] items-center justify-center px-4">
      <Card className="w-full max-w-md text-center">
        <CardContent className="flex flex-col items-center gap-4 p-8">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-destructive/10">
            <Lock className="h-6 w-6 text-destructive" aria-hidden="true" />
          </div>
          <div className="space-y-1">
            <h2 className="font-serif text-xl font-semibold text-primary">Access Restricted</h2>
            <p className="text-sm text-muted-foreground">{message}</p>
          </div>
          <Button asChild>
            <Link to="/dashboard">Go to Dashboard</Link>
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
