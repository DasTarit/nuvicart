import { createAdminClient } from "@/lib/supabase/admin";
import { Card } from "@/components/ui/card";

export default async function AdminDashboard() {
  const db = createAdminClient();
  const [
    orders, pendingPayment, paid, processing, shipped, delivered, cancelled, revenue,
    lowStock, failedPayments, fulfillmentExceptions, notificationFailures
  ] = await Promise.all([
    db.from("orders").select("id",{count:"exact",head:true}),
    db.from("orders").select("id",{count:"exact",head:true}).eq("payment_status","pending"),
    db.from("orders").select("id",{count:"exact",head:true}).eq("payment_status","paid"),
    db.from("orders").select("id",{count:"exact",head:true}).eq("status","processing"),
    db.from("orders").select("id",{count:"exact",head:true}).eq("status","shipped"),
    db.from("orders").select("id",{count:"exact",head:true}).eq("status","delivered"),
    db.from("orders").select("id",{count:"exact",head:true}).eq("status","cancelled"),
    db.from("orders").select("grand_total").eq("payment_status","paid").limit(10000),
    db.from("inventory").select("id,stock_quantity,reserved_quantity").lt("stock_quantity",5).limit(100),
    db.from("payment_attempts").select("id",{count:"exact",head:true}).eq("status","failed"),
    db.from("fulfillments").select("id",{count:"exact",head:true}).not("shipping_error","is",null),
    db.from("notification_events").select("id",{count:"exact",head:true}).in("delivery_status",["failed"]),
  ]);
  const totalRevenue=(revenue.data??[]).reduce((sum,r)=>sum+Number(r.grand_total??0),0);
  const metrics=[
    ["Total orders",orders.count??0],["Pending payment",pendingPayment.count??0],["Paid",paid.count??0],
    ["Processing",processing.count??0],["Shipped",shipped.count??0],["Delivered",delivered.count??0],
    ["Cancelled",cancelled.count??0],["Revenue",`₹${totalRevenue.toFixed(2)}`],
    ["Low stock",lowStock.data?.length??0],["Failed payments",failedPayments.count??0],
    ["Fulfillment exceptions",fulfillmentExceptions.count??0],["Notification failures",notificationFailures.count??0]
  ];
  return <main className="p-4 sm:p-6 lg:p-8">
    <div><p className="text-xs font-semibold uppercase tracking-[.18em] text-primary">Operations</p><h1 className="mt-2 text-3xl font-semibold">Dashboard</h1><p className="mt-2 text-sm text-muted">Live operational metrics from the existing commerce state.</p></div>
    <div className="mt-8 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">{metrics.map(([label,value])=><Card key={String(label)} className="p-5"><p className="text-sm text-muted">{label}</p><p className="mt-2 text-2xl font-semibold">{value}</p></Card>)}</div>
  </main>;
}
