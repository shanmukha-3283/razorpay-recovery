import { useState } from "react";
import { Link, createFileRoute } from "@tanstack/react-router";
import {
  useMarkInvoicePaid,
  useReceivable,
  useRecordPromise,
} from "@/service/hooks";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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

export const Route = createFileRoute("/receivables/$id")({
  component: ReceivableDetailPage,
});

function ReceivableDetailPage() {
  const { id } = Route.useParams();
  const { data, isLoading } = useReceivable(id);
  const promiseMutation = useRecordPromise();
  const paidMutation = useMarkInvoicePaid();
  const [promisedDate, setPromisedDate] = useState("");
  const [promisedAmount, setPromisedAmount] = useState("");

  if (isLoading) return <p className="text-muted-foreground">Loading…</p>;
  if (!data) return <p className="text-muted-foreground">Invoice not found.</p>;

  const canAct = data.status !== "paid";

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <Button variant="ghost" size="sm" asChild>
            <Link to="/receivables">← Back</Link>
          </Button>
          <h1 className="text-2xl font-bold tracking-tight">
            {data.externalId}
          </h1>
          <p className="text-sm text-muted-foreground">
            {data.customerName ?? data.customerEmail ?? "No customer"} ·{" "}
            {formatINR(data.amount, data.currency ?? "INR")} · due{" "}
            {formatDateTime(data.dueDate)}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Badge>{data.status}</Badge>
          {canAct && (
            <Button
              variant="default"
              size="sm"
              onClick={() => paidMutation.mutate(id)}
              disabled={paidMutation.isPending}
            >
              {paidMutation.isPending ? "Marking…" : "Mark paid"}
            </Button>
          )}
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Payment promises</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Promised date</TableHead>
                <TableHead>Amount</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Recorded</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.promises.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={4} className="h-24 text-center text-muted-foreground">
                    No promises yet.
                  </TableCell>
                </TableRow>
              ) : (
                data.promises.map((p) => (
                  <TableRow key={p.id}>
                    <TableCell>{formatDateTime(p.promisedDate)}</TableCell>
                    <TableCell>
                      {p.promisedAmount != null
                        ? formatINR(p.promisedAmount, data.currency ?? "INR")
                        : "—"}
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant={
                          p.status === "kept"
                            ? "success"
                            : p.status === "breached"
                            ? "destructive"
                            : "secondary"
                        }
                      >
                        {p.status}
                      </Badge>
                    </TableCell>
                    <TableCell>{formatDateTime(p.createdAt)}</TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
          {canAct && (
            <div className="flex flex-wrap items-end gap-2">
              <div>
                <label className="text-xs text-muted-foreground">
                  Promised date
                </label>
                <Input
                  type="date"
                  value={promisedDate}
                  onChange={(e) => setPromisedDate(e.target.value)}
                />
              </div>
              <div>
                <label className="text-xs text-muted-foreground">
                  Amount (optional)
                </label>
                <Input
                  type="number"
                  value={promisedAmount}
                  onChange={(e) => setPromisedAmount(e.target.value)}
                  placeholder={String(data.amount)}
                />
              </div>
              <Button
                size="sm"
                disabled={!promisedDate || promiseMutation.isPending}
                onClick={() =>
                  promiseMutation.mutate({
                    id,
                    body: {
                      promised_date: promisedDate,
                      ...(promisedAmount
                        ? { promised_amount: Number(promisedAmount) }
                        : {}),
                    },
                  })
                }
              >
                {promiseMutation.isPending ? "Recording…" : "Record promise"}
              </Button>
              {promiseMutation.isError && (
                <p className="text-sm text-destructive">
                  {promiseMutation.error.message}
                </p>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Dunning touches</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Attempt</TableHead>
                <TableHead>Action</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Created</TableHead>
                <TableHead>Next attempt</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.recoveryAttempts.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="h-24 text-center text-muted-foreground">
                    No touches yet.
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
