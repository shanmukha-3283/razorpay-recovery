import { useState } from "react";
import { Link, createFileRoute } from "@tanstack/react-router";
import type { ColumnDef } from "@tanstack/react-table";
import { DataTable } from "@/components/data-table";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useCheckouts } from "@/service/hooks";
import type { Checkout } from "@/lib/types";
import { formatDateTime, formatINR } from "@/lib/utils";

export const Route = createFileRoute("/checkouts")({
  component: CheckoutsPage,
});

const statusVariant = (s: string): "default" | "success" | "warning" | "destructive" | "secondary" | "outline" => {
  switch (s) {
    case "recovered":
      return "success";
    case "abandoned":
      return "warning";
    case "reminded":
    case "escalated":
      return "secondary";
    case "expired":
      return "destructive";
    default:
      return "outline";
  }
};

function CheckoutsPage() {
  const [page, setPage] = useState(1);
  const { data, isLoading } = useCheckouts({ page: String(page) });

  const columns: ColumnDef<Checkout, unknown>[] = [
    {
      header: "Order",
      accessorKey: "razorpayOrderId",
      cell: ({ row }) => (
        <Button variant="link" className="px-0" asChild>
          <Link to="/checkouts/$id" params={{ id: row.original.id }}>
            {row.original.razorpayOrderId}
          </Link>
        </Button>
      ),
    },
    {
      header: "Customer",
      cell: ({ row }) =>
        row.original.email ?? row.original.contact ?? "—",
    },
    {
      header: "Amount",
      cell: ({ row }) =>
        formatINR(row.original.amount, row.original.currency ?? "INR"),
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
    {
      header: "Abandoned",
      accessorKey: "createdAt",
      cell: ({ getValue }) => formatDateTime(getValue() as string),
    },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Abandoned Checkouts</h1>
        <p className="text-sm text-muted-foreground">
          Unpaid orders with bounded payment-link reminders
        </p>
      </div>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            {isLoading ? "Loading…" : `${data?.meta.total ?? 0} checkouts`}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <DataTable<Checkout>
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
