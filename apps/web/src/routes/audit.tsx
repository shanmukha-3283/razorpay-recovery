import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import type { ColumnDef } from "@tanstack/react-table";
import { DataTable } from "@/components/data-table";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useAudit } from "@/service/hooks";
import type { AuditEntry } from "@/lib/types";
import { formatDateTime, formatINR } from "@/lib/utils";

export const Route = createFileRoute("/audit")({
  component: AuditPage,
});

function AuditPage() {
  const [page, setPage] = useState(1);
  const { data, isLoading } = useAudit({ page: String(page) });

  const columns: ColumnDef<AuditEntry, unknown>[] = [
    {
      header: "Timestamp",
      accessorKey: "timestamp",
      cell: ({ getValue }) => formatDateTime(getValue() as string),
    },
    { header: "Action", accessorKey: "action" },
    {
      header: "Amount",
      accessorKey: "amount",
      cell: ({ getValue }) => formatINR(getValue() as number | null),
    },
    {
      header: "Recovery attempt",
      accessorKey: "recoveryAttemptId",
      cell: ({ getValue }) => (
        <span className="font-mono text-xs">{(getValue() as string).slice(0, 8)}</span>
      ),
    },
    {
      header: "Type",
      cell: ({ row }) =>
        row.original.action.startsWith("credit_reminder") ? (
          <Badge variant="success">Recovery</Badge>
        ) : (
          <Badge variant="secondary">{row.original.action.split("_")[0]}</Badge>
        ),
    },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Audit Ledger</h1>
        <p className="text-sm text-muted-foreground">
          Immutable log of every recovery action (action, amount, timestamp)
        </p>
      </div>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            {isLoading ? "Loading…" : `${data?.meta.total ?? 0} entries`}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <DataTable<AuditEntry>
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
