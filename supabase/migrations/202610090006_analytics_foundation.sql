-- Phase 7A: read-only analytics/reporting foundation.
-- Analytics never becomes authoritative commerce state and introduces no v2 commerce tables.

create or replace function public.get_analytics_summary(
  p_start_at timestamptz,
  p_end_at timestamptz
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := public.require_admin_actor();
  v_order_count bigint;
  v_gross numeric;
  v_paid_revenue numeric;
  v_paid_orders bigint;
  v_cancelled bigint;
  v_delivered bigint;
  v_avg numeric;
  v_pending_payment bigint;
  v_processing bigint;
  v_shipped bigint;
  v_paid_status bigint;
  v_failed_payment bigint;
  v_captured bigint;
  v_failed_attempts bigint;
  v_success_rate numeric;
  v_total_customers bigint;
  v_customers_with_paid_orders bigint;
  v_new_customers bigint;
  v_repeat_customers bigint;
  v_fulfillment_processing bigint;
  v_fulfillment_ready bigint;
  v_fulfillment_shipped bigint;
  v_fulfillment_delivered bigint;
  v_fulfillment_cancelled bigint;
  v_fulfillment_pending bigint;
  v_fulfillment_exceptions bigint;
  v_notification_pending bigint;
  v_notification_processing bigint;
  v_notification_sent bigint;
  v_notification_failed bigint;
  v_notification_retryable bigint;
  v_notification_delivery_rate numeric;
  v_low_stock bigint;
  v_out_of_stock bigint;
  v_product_rows jsonb;
  v_product_units_rows jsonb;
  v_category_rows jsonb;
  v_low_stock_rows jsonb;
begin
  if v_actor is null then raise exception 'UNAUTHENTICATED'; end if;
  if p_start_at is null or p_end_at is null or p_start_at >= p_end_at then
    raise exception 'INVALID_ANALYTICS_DATE_RANGE';
  end if;
  if p_end_at - p_start_at > interval '366 days' then
    raise exception 'ANALYTICS_DATE_RANGE_TOO_LARGE';
  end if;

  select count(*), coalesce(sum(o.grand_total),0),
         coalesce(sum(o.grand_total) filter (where o.payment_status='paid'),0),
         count(*) filter (where o.payment_status='paid'),
         count(*) filter (where o.status='cancelled'),
         count(*) filter (where o.status='delivered'),
         count(*) filter (where o.payment_status='pending'),
         count(*) filter (where o.status='processing'),
         count(*) filter (where o.status='shipped'),
         count(*) filter (where o.status='paid')
    into v_order_count,v_gross,v_paid_revenue,v_paid_orders,v_cancelled,v_delivered,
         v_pending_payment,v_processing,v_shipped,v_paid_status
  from public.orders o
  where o.created_at >= p_start_at and o.created_at < p_end_at;

  v_avg := case when v_order_count = 0 then 0 else round(v_gross / v_order_count, 2) end;

  select count(*) filter (where pa.status='failed'), count(*) filter (where pa.status='captured')
    into v_failed_attempts, v_captured
  from public.payment_attempts pa
  join public.orders o on o.id=pa.order_id
  where pa.created_at >= p_start_at and pa.created_at < p_end_at;
  -- Retryable failures mirror the authoritative reopen_failed_payment() eligibility:
  -- the failed attempt must belong to an order that is still pending_payment/failed.
  -- Once a retry reopens the order to pending, the historical failed attempt is no
  -- longer retryable itself and must not inflate this metric.
  select count(*) into v_failed_payment
  from public.payment_attempts pa
  join public.orders o on o.id=pa.order_id
  where pa.status='failed'
    and o.status='pending_payment'
    and o.payment_status='failed'
    and pa.created_at >= p_start_at
    and pa.created_at < p_end_at;
  v_success_rate := case when (v_captured + v_failed_attempts)=0 then 0 else round((v_captured::numeric/(v_captured+v_failed_attempts))*100,2) end;

  select count(*) into v_total_customers from public.profiles where role='customer';
  select count(distinct o.user_id) into v_customers_with_paid_orders
  from public.orders o where o.payment_status='paid' and o.created_at >= p_start_at and o.created_at < p_end_at;
  select count(*) into v_new_customers from public.profiles p
  where p.role='customer' and p.created_at >= p_start_at and p.created_at < p_end_at;
  select count(*) into v_repeat_customers from (
    select o.user_id from public.orders o
    where o.payment_status='paid' and o.created_at >= p_start_at and o.created_at < p_end_at
    group by o.user_id having count(*) > 1
  ) repeat_users;

  select count(*) filter (where f.status='pending'), count(*) filter (where f.status='processing'),
         count(*) filter (where f.status='ready_to_ship'), count(*) filter (where f.status='shipped'),
         count(*) filter (where f.status='delivered'), count(*) filter (where f.status='cancelled')
    into v_fulfillment_pending,v_fulfillment_processing,v_fulfillment_ready,v_fulfillment_shipped,
         v_fulfillment_delivered,v_fulfillment_cancelled
  from public.fulfillments f
  join public.orders o on o.id=f.order_id
  where f.created_at >= p_start_at and f.created_at < p_end_at;

  -- The current schema has one explicit operational exception state: paid_inventory_issue.
  select count(*) into v_fulfillment_exceptions from public.orders o
  where o.payment_status='paid_inventory_issue' and o.created_at >= p_start_at and o.created_at < p_end_at;

  select count(*) filter (where n.delivery_status='pending'),
         count(*) filter (where n.delivery_status='processing'),
         count(*) filter (where n.delivery_status='sent'),
         count(*) filter (where n.delivery_status='failed'),
         count(*) filter (where n.delivery_status='failed' and n.failure_kind='retryable')
    into v_notification_pending,v_notification_processing,v_notification_sent,v_notification_failed,v_notification_retryable
  from public.notification_events n
  where n.created_at >= p_start_at and n.created_at < p_end_at;
  v_notification_delivery_rate := case when (v_notification_sent+v_notification_failed)=0 then 0 else round((v_notification_sent::numeric/(v_notification_sent+v_notification_failed))*100,2) end;

  select count(*) filter (where greatest(i.stock_quantity-i.reserved_quantity,0) < 5),
         count(*) filter (where greatest(i.stock_quantity-i.reserved_quantity,0) = 0)
    into v_low_stock,v_out_of_stock
  from public.inventory i;

  select coalesce(jsonb_agg(row_to_json(t)::jsonb order by t.revenue desc), '[]'::jsonb)
    into v_product_rows
  from (
    select oi.product_id, oi.variant_id, oi.product_name, oi.variant_name,
           sum(oi.quantity)::bigint as units_sold,
           round(sum(oi.line_subtotal),2) as revenue,
           count(distinct oi.order_id)::bigint as order_count
    from public.order_items oi
    join public.orders o on o.id=oi.order_id
    where o.created_at >= p_start_at and o.created_at < p_end_at and o.payment_status='paid'
    group by oi.product_id,oi.variant_id,oi.product_name,oi.variant_name
    order by revenue desc
    limit 25
  ) t;

  select coalesce(jsonb_agg(row_to_json(t)::jsonb order by t.units_sold desc), '[]'::jsonb)
    into v_product_units_rows
  from (
    select oi.product_id, oi.variant_id, oi.product_name, oi.variant_name,
           sum(oi.quantity)::bigint as units_sold,
           round(sum(oi.line_subtotal),2) as revenue,
           count(distinct oi.order_id)::bigint as order_count
    from public.order_items oi
    join public.orders o on o.id=oi.order_id
    where o.created_at >= p_start_at and o.created_at < p_end_at and o.payment_status='paid'
    group by oi.product_id,oi.variant_id,oi.product_name,oi.variant_name
    order by units_sold desc
    limit 25
  ) t;

  -- order_items do not contain a category snapshot. Therefore this report explicitly labels
  -- category attribution as current-catalog attribution rather than pretending historical exactness.
  select coalesce(jsonb_agg(row_to_json(t)::jsonb order by t.revenue desc), '[]'::jsonb)
    into v_category_rows
  from (
    select c.id as category_id, c.name as category_name,
           sum(oi.quantity)::bigint as units_sold,
           round(sum(oi.line_subtotal),2) as revenue,
           'current_catalog_attribution'::text as attribution
    from public.order_items oi
    join public.orders o on o.id=oi.order_id
    join public.products p on p.id=oi.product_id
    join public.categories c on c.id=p.category_id
    where o.created_at >= p_start_at and o.created_at < p_end_at and o.payment_status='paid'
    group by c.id,c.name
    order by revenue desc
    limit 25
  ) t;

  select coalesce(jsonb_agg(row_to_json(t)::jsonb order by t.available_quantity asc,t.product_name), '[]'::jsonb)
    into v_low_stock_rows
  from (
    select i.id, i.product_id, i.variant_id, coalesce(p.name,'Archived / deleted product') as product_name,
           pv.name as variant_name, greatest(i.stock_quantity-i.reserved_quantity,0) as available_quantity,
           i.stock_quantity, i.reserved_quantity
    from public.inventory i
    left join public.products p on p.id=i.product_id
    left join public.product_variants pv on pv.id=i.variant_id
    where greatest(i.stock_quantity-i.reserved_quantity,0) < 5
    order by available_quantity asc, product_name
    limit 50
  ) t;

  return jsonb_build_object(
    'date_range', jsonb_build_object('start_at',p_start_at,'end_at',p_end_at,'timezone','UTC','max_days',366),
    'definitions', jsonb_build_object(
      'gross_order_value','Sum of authoritative orders.grand_total for orders created in the selected UTC range.',
      'paid_revenue','Sum of orders.grand_total where authoritative payment_status=paid in the selected UTC range.',
      'average_order_value','Gross order value divided by order count; no order_items double-counting.',
      'product_performance','Paid-order order_items snapshots; current product price is never used.',
      'category_performance','Current-catalog attribution only because order_items has no category snapshot; not historical-exact.',
      'low_stock_threshold',5,
      'fulfillment_exceptions','Orders in the existing paid_inventory_issue exceptional payment state.',
      'payment_success_rate','Captured payment attempts divided by captured plus failed attempts; retryable_failures is the subset of failed attempts whose order is currently eligible for reopen_failed_payment.',
      'notification_delivery_rate','Sent notifications divided by sent plus failed notifications.'
    ),
    'sales',jsonb_build_object('gross_order_value',v_gross,'paid_revenue',v_paid_revenue,'order_count',v_order_count,'average_order_value',v_avg,'cancelled_orders',v_cancelled,'delivered_orders',v_delivered),
    'orders',jsonb_build_object('pending_payment',v_pending_payment,'paid',v_paid_status,'processing',v_processing,'shipped',v_shipped,'delivered',v_delivered,'cancelled',v_cancelled),
    'products',jsonb_build_object('top_by_revenue',v_product_rows,'top_by_units',v_product_units_rows,'low_stock_count',v_low_stock,'out_of_stock_count',v_out_of_stock,'low_stock',v_low_stock_rows),
    'categories',jsonb_build_object('rows',v_category_rows,'attribution','current_catalog_attribution'),
    'customers',jsonb_build_object('total_customers',v_total_customers,'customers_with_paid_orders',v_customers_with_paid_orders,'new_customers',v_new_customers,'repeat_customers',v_repeat_customers),
    'payments',jsonb_build_object('successful_payments',v_captured,'failed_attempts',v_failed_attempts,'retryable_failures',v_failed_payment,'payment_success_rate_percent',v_success_rate),
    'fulfillment',jsonb_build_object('pending',v_fulfillment_pending,'processing',v_fulfillment_processing,'ready_to_ship',v_fulfillment_ready,'shipped',v_fulfillment_shipped,'delivered',v_fulfillment_delivered,'cancelled',v_fulfillment_cancelled,'exceptions',v_fulfillment_exceptions),
    'notifications',jsonb_build_object('pending',v_notification_pending,'processing',v_notification_processing,'sent',v_notification_sent,'failed',v_notification_failed,'retryable',v_notification_retryable,'delivery_rate_percent',v_notification_delivery_rate)
  );
end;
$$;

revoke all on function public.get_analytics_summary(timestamptz,timestamptz) from public, anon;
grant execute on function public.get_analytics_summary(timestamptz,timestamptz) to authenticated;
