import Link from "next/link";
import { auth } from "@/auth";
import { redirect } from "next/navigation";
import { listFundsWithStats } from "@/lib/discoveryFundList";
import DashboardNav from "@/components/DashboardNav";
import DiscoveryFundsList from "@/components/DiscoveryFundsList";

export const metadata = {
  title: "Fondos · Discovery · Moatboard",
};

export default async function DiscoveryFundsPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/auth/signin");

  const funds = await listFundsWithStats();

  return (
    <div className="flex min-h-screen flex-col">
      <DashboardNav />
      <main className="mx-auto w-full max-w-6xl flex-1 px-6 py-8">
        <div className="mb-4">
          <Link
            href="/dashboard/discovery"
            className="text-sm text-navy-600 hover:text-navy-900"
          >
            ← Discovery
          </Link>
        </div>

        <header className="mb-6">
          <h1 className="text-2xl font-bold text-navy-950">Fondos</h1>
          <p className="mt-2 max-w-3xl text-sm text-navy-600">
            Roster completo agrupado por tipología. Click en cualquier fondo
            para ver su ficha con holdings + movimientos del trimestre. La
            columna Movs. Q cuenta nuevas + aumentos + recortes + salidas
            entre los dos últimos 13F (solo cambios de convicción; los
            reajustes que mantienen el peso objetivo se omiten).
          </p>
        </header>

        <DiscoveryFundsList funds={funds} />
      </main>
    </div>
  );
}
