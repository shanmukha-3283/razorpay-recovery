import { Outlet, createRootRoute } from "@tanstack/react-router";
import { AppSidebar } from "@/components/layout/sidebar";

export const Route = createRootRoute({
  component: RootComponent,
});

function RootComponent() {
  return (
    <div className="min-h-screen bg-background">
      <AppSidebar />
      <main className="md:pl-64">
        <div className="mx-auto max-w-6xl p-6 md:p-8">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
