import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import type { ColumnDef } from "@tanstack/react-table";
import { DataTable } from "@/components/data-table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  useAddDnd,
  useDeliveries,
  useDnd,
  useRemoveDnd,
} from "@/service/hooks";
import type { Delivery, DndEntry } from "@/lib/types";
import { formatDateTime } from "@/lib/utils";

export const Route = createFileRoute("/deliveries")({
  component: DeliveriesPage,
});

const statusVariant = (s: string) =>
  s === "sent"
    ? "success"
    : s === "failed"
    ? "destructive"
    : s === "skipped"
    ? "secondary"
    : "warning";

function DeliveriesPage() {
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState<string | undefined>();
  const { data, isLoading } = useDeliveries({
    page: String(page),
    ...(status ? { status } : {}),
  });

  const columns: ColumnDef<Delivery, unknown>[] = [
    {
      header: "Subscription",
      accessorKey: "razorpaySubscriptionId",
      cell: ({ getValue }) => (getValue() as string) ?? "—",
    },
    { header: "Channel", accessorKey: "channel" },
    {
      header: "Recipient",
      accessorKey: "toEmail",
      cell: ({ getValue }) => (getValue() as string) ?? "—",
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
      header: "Provider",
      accessorKey: "providerMessageId",
      cell: ({ getValue }) =>
        (getValue() as string) ? (
          <span className="font-mono text-xs">{(getValue() as string).slice(0, 12)}…</span>
        ) : (
          "—"
        ),
    },
    {
      header: "Error",
      accessorKey: "error",
      cell: ({ getValue }) =>
        (getValue() as string | null) ? (
          <span className="text-xs text-destructive">{getValue() as string}</span>
        ) : (
          "—"
        ),
    },
    {
      header: "Sent",
      accessorKey: "sentAt",
      cell: ({ getValue }) => formatDateTime(getValue() as string | null),
    },
    {
      header: "Created",
      accessorKey: "createdAt",
      cell: ({ getValue }) => formatDateTime(getValue() as string),
    },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Deliveries</h1>
        <p className="text-sm text-muted-foreground">
          Outbound recovery messages sent to customers
        </p>
      </div>

      <div className="flex items-center gap-2">
        <label className="text-sm text-muted-foreground">Status:</label>
        {["sent", "failed", "skipped", "queued"].map((s) => (
          <button
            key={s}
            onClick={() => {
              setStatus(status === s ? undefined : s);
              setPage(1);
            }}
            className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors cursor-pointer ${
              status === s
                ? "bg-primary text-primary-foreground"
                : "hover:bg-accent"
            }`}
          >
            {s}
          </button>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            {isLoading ? "Loading…" : `${data?.meta.total ?? 0} deliveries`}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <DataTable<Delivery>
            columns={columns}
            data={data?.data ?? []}
            meta={data?.meta}
            onPageChange={setPage}
          />
        </CardContent>
      </Card>

      <DndManager />
    </div>
  );
}

function DndManager() {
  const { data } = useDnd({ page: "1" });
  const addMutation = useAddDnd();
  const removeMutation = useRemoveDnd();
  const [email, setEmail] = useState("");

  const columns: ColumnDef<DndEntry, unknown>[] = [
    { header: "Email", accessorKey: "email" },
    {
      header: "Reason",
      accessorKey: "reason",
      cell: ({ getValue }) => (getValue() as string) ?? "—",
    },
    {
      header: "Added",
      accessorKey: "createdAt",
      cell: ({ getValue }) => formatDateTime(getValue() as string),
    },
    {
      header: "",
      accessorKey: "id",
      cell: ({ row }) => (
        <Button
          variant="outline"
          size="sm"
          disabled={removeMutation.isPending}
          onClick={() => removeMutation.mutate(row.original.id)}
        >
          Remove
        </Button>
      ),
    },
  ];

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">
          Do-not-disturb list ({data?.meta.total ?? 0})
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-end gap-2">
          <div>
            <label className="text-xs text-muted-foreground">Email</label>
            <Input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="stop@example.com"
            />
          </div>
          <Button
            size="sm"
            disabled={!email.trim() || addMutation.isPending}
            onClick={() => {
              addMutation.mutate({ email: email.trim() });
              setEmail("");
            }}
          >
            {addMutation.isPending ? "Adding…" : "Add to DND"}
          </Button>
          {addMutation.isError && (
            <p className="text-sm text-destructive">
              {addMutation.error.message}
            </p>
          )}
        </div>
        <DataTable<DndEntry>
          columns={columns}
          data={data?.data ?? []}
          meta={data?.meta}
          onPageChange={() => {}}
        />
      </CardContent>
    </Card>
  );
}
