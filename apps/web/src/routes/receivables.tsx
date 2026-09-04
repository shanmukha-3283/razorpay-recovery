import { useState } from "react";
import { Link, createFileRoute } from "@tanstack/react-router";
import type { ColumnDef } from "@tanstack/react-table";
import { DataTable } from "@/components/data-table";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useReceivables } from "@/service/hooks";
import type { ReceivableInvoice } from "@/lib/types";
import { formatDateTime, formatINR } from "@/lib/utils";

export const Route = createFileRoute("/receivables")({
  component: ReceivablesPage,
});

const statusVariant = (s: string): "default" | "success" | "warning" | "destructive" | "secondary" | "outline" => {
  switch (s) {
    case "paid":
      return "success";
    case "overdue":
      return "warning";
    case "promised":
      return "secondary";
    case "breached":
    case "breached-closed":
      return "destructive";
    default:
      return "outline";
  }
};

function daysOverdue(dueDate: string | null): string {
  if (!dueDate) return "—";
  const days = Math.max(
    0,
    Math.floor((Date.now() - new Date(dueDate).getTime()) / 86400000)
  );
  return `${days}d`;
}

function ReceivablesPage() {
  const [page, setPage] = useState(1);
  const { data, isLoading } = useReceivables({ page: String(page) });

  const columns: ColumnDef<ReceivableInvoice, unknown>[] = [
    {
      header: "Invoice",
      accessorKey: "externalId",
      cell: ({ row }) => (
        <Button variant="link" className="px-0" asChild>
          <Link to="/receivables/$id" params={{ id: row.original.id }}>
            {row.original.externalId}
          </Link>
        </Button>
      ),
    },
    {
      header: "Customer",
      cell: ({ row }) =>
        row.original.customerName ??
        row.original.customerEmail ??
        "—",
    },
    {
      header: "Amount",
      cell: ({ row }) =>
        formatINR(row.original.amount, row.original.currency ?? "INR"),
    },
    {
      header: "Due",
      accessorKey: "dueDate",
      cell: ({ getValue }) => formatDateTime(getValue() as string | null),
    },
    {
      header: "Overdue",
      accessorKey: "dueDate",
      cell: ({ row }) => daysOverdue(row.original.dueDate),
    },
    {
      header: "Status",
      accessorKey: "status",
      cell: ({ getValue }) => (
        <Badge variant={statusVariant(getValue() as string)}>
          {getValue() as string}
        </Badge>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Receivables</h1>
        <p className="text-sm text-muted-foreground">
          Overdue B2B invoices with bounded dunning and promise tracking
        </p>
      </div>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            {isLoading ? "Loading…" : `${data?.meta.total ?? 0} invoices`}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <DataTable<ReceivableInvoice>
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
