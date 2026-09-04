import { Link, createFileRoute } from "@tanstack/react-router";
import { ExternalLink } from "lucide-react";
import { useCheckout } from "@/service/hooks";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatDateTime, formatINR } from "@/lib/utils";
import { getAttemptInsight } from "@/lib/attemptDetails";

export const Route = createFileRoute("/checkouts/$id")({
  component: CheckoutDetailPage,
});

function CheckoutDetailPage() {
  const { id } = Route.useParams();
  const { data, isLoading } = useCheckout(id);

  if (isLoading) return <p className="text-muted-foreground">Loading…</p>;
  if (!data)
    return <p className="text-muted-foreground">Checkout not found.</p>;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <Button variant="ghost" size="sm" asChild>
            <Link to="/checkouts">← Back</Link>
          </Button>
          <h1 className="text-2xl font-bold tracking-tight">
            {data.razorpayOrderId}
          </h1>
          <p className="text-sm text-muted-foreground">
            {data.email ?? data.contact ?? "No customer"} ·{" "}
            {formatINR(data.amount, data.currency ?? "INR")}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Badge>{data.status}</Badge>
          {data.shortUrl && (
            <Button variant="outline" size="sm" asChild>
              <a href={data.shortUrl} target="_blank" rel="noreferrer">
                <ExternalLink className="size-4" />
                Payment link
              </a>
            </Button>
          )}
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Reminders</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Attempt</TableHead>
                <TableHead>Action</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Amount</TableHead>
                <TableHead>Created</TableHead>
                <TableHead>Next attempt</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.recoveryAttempts.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="h-24 text-center text-muted-foreground">
                    No reminders yet.
                  </TableCell>
                </TableRow>
              ) : (
                data.recoveryAttempts.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell>#{r.attemptNumber}</TableCell>
                    <TableCell>
                      <div>{r.action}</div>
                      {(() => {
                        const insight = getAttemptInsight(r.details);
                        return (
                          (insight.failureCategory || insight.reason) && (
                            <div className="mt-1 space-y-1">
                              {insight.failureCategory && (
                                <Badge variant="secondary">
                                  {insight.failureCategory}
                                </Badge>
                              )}
                              {insight.reason && (
                                <p className="text-xs text-muted-foreground">
                                  {insight.reason}
                                </p>
                              )}
                            </div>
                          )
                        );
                      })()}
                    </TableCell>
                    <TableCell>
                      <Badge variant={r.status === "completed" ? "success" : r.status === "failed" ? "destructive" : "warning"}>
                        {r.status}
                      </Badge>
                    </TableCell>
                    <TableCell>{formatINR(r.amount)}</TableCell>
                    <TableCell>{formatDateTime(r.createdAt)}</TableCell>
                    <TableCell>{formatDateTime(r.nextAttemptAt)}</TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
