import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import type { ColumnDef } from "@tanstack/react-table";
import { DataTable } from "@/components/data-table";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useRecovery } from "@/service/hooks";
import type { RecoveryAttempt } from "@/lib/types";
import { formatDateTime, formatINR } from "@/lib/utils";

export const Route = createFileRoute("/recovery")({
  component: RecoveryPage,
});

const statusVariant = (s: string) =>
  s === "completed"
    ? "success"
    : s === "failed"
    ? "destructive"
    : "warning";

function RecoveryPage() {
  const [page, setPage] = useState(1);
  const { data, isLoading } = useRecovery({ page: String(page) });

  const columns: ColumnDef<RecoveryAttempt, unknown>[] = [
    {
      header: "Subscription",
      accessorKey: "razorpaySubscriptionId",
      cell: ({ getValue }) => (getValue() as string) ?? "—",
    },
    {
      header: "Attempt",
      accessorKey: "attemptNumber",
      cell: ({ getValue }) => `#${getValue() as number}`,
    },
    { header: "Action", accessorKey: "action" },
    {
      header: "Status",
      accessorKey: "status",
      cell: ({ getValue }) => (
        <Badge variant={statusVariant(getValue() as string)}>
          {getValue() as string}
        </Badge>
      ),
    },
    {
      header: "Amount",
      accessorKey: "amount",
      cell: ({ getValue }) => formatINR(getValue() as number | null),
    },
    {
      header: "Created",
      accessorKey: "createdAt",
      cell: ({ getValue }) => formatDateTime(getValue() as string),
    },
    {
      header: "Next attempt",
      accessorKey: "nextAttemptAt",
      cell: ({ getValue }) => formatDateTime(getValue() as string | null),
    },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Recovery Attempts</h1>
        <p className="text-sm text-muted-foreground">
          Scheduled retry actions driven by the LangGraph agent
        </p>
      </div>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            {isLoading ? "Loading…" : `${data?.meta.total ?? 0} attempts`}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <DataTable<RecoveryAttempt>
            columns={columns}
            data={data?.data ?? []}
            meta={data?.meta}
            onPageChange={setPage}
          />
        </CardContent>
      </Card>
    </div>
  );
}
