-- Phase 8 production hardening.
-- Restrict SECURITY DEFINER execution to the authenticated/service roles that
-- actually invoke each function. Trigger functions remain trigger-only.
-- No commerce tables or state-machine logic are changed.

-- Trigger/internal helpers: no direct client execution.
revoke all on function public.set_updated_at() from public, anon, authenticated;
revoke all on function public.handle_new_user() from public, anon, authenticated;
revoke all on function public.prevent_untrusted_role_change() from public, anon, authenticated;
revoke all on function public.prevent_untrusted_profile_system_change() from public, anon, authenticated;
revoke all on function public.set_order_updated_at() from public, anon, authenticated;
revoke all on function public.validate_order_state_transition() from public, anon, authenticated;
revoke all on function public.validate_order_state_consistency() from public, anon, authenticated;
revoke all on function public.validate_payment_attempt_transition() from public, anon, authenticated;
revoke all on function public.validate_cart_item_variant() from public, anon, authenticated;
revoke all on function public.validate_fulfillment_status_transition() from public, anon, authenticated;
revoke all on function public.set_payment_attempt_updated_at() from public, anon, authenticated;
revoke all on function public.set_notification_event_updated_at() from public, anon, authenticated;

-- Customer/checkout RPCs: authenticated users only.
revoke all on function public.set_default_customer_address(uuid) from public, anon, authenticated;
grant execute on function public.set_default_customer_address(uuid) to authenticated;

revoke all on function public.get_checkout_preview() from public, anon, authenticated;
grant execute on function public.get_checkout_preview() to authenticated;

revoke all on function public.create_order_from_cart(uuid,text) from public, anon, authenticated;
grant execute on function public.create_order_from_cart(uuid,text) to authenticated;

revoke all on function public.create_order_from_cart(uuid,text,text) from public, anon, authenticated;
grant execute on function public.create_order_from_cart(uuid,text,text) to authenticated;

revoke all on function public.prepare_payment_attempt(uuid) from public, anon, authenticated;
grant execute on function public.prepare_payment_attempt(uuid) to authenticated;

revoke all on function public.reopen_failed_payment(uuid) from public, anon, authenticated;
grant execute on function public.reopen_failed_payment(uuid) to authenticated;

revoke all on function public.validate_promotion_for_cart(text) from public, anon, authenticated;
grant execute on function public.validate_promotion_for_cart(text) to authenticated;

-- Fulfillment/shipping operator RPCs: authenticated role is required; each
-- function independently enforces the fulfillment/admin role boundary.
revoke all on function public.require_fulfillment_operator() from public, anon, authenticated;
grant execute on function public.require_fulfillment_operator() to authenticated;

revoke all on function public.create_fulfillment_for_order(uuid) from public, anon, authenticated;
grant execute on function public.create_fulfillment_for_order(uuid) to authenticated;

revoke all on function public.transition_fulfillment(uuid,text) from public, anon, authenticated;
grant execute on function public.transition_fulfillment(uuid,text) to authenticated;

revoke all on function public.assign_manual_shipment(uuid,text,text,text) from public, anon, authenticated;
grant execute on function public.assign_manual_shipment(uuid,text,text,text) to authenticated;

revoke all on function public.claim_shiprocket_creation(uuid) from public, anon, authenticated;
grant execute on function public.claim_shiprocket_creation(uuid) to authenticated;

revoke all on function public.record_shiprocket_provider_order(uuid,uuid,text,text) from public, anon, authenticated;
grant execute on function public.record_shiprocket_provider_order(uuid,uuid,text,text) to authenticated;

revoke all on function public.complete_shiprocket_creation(uuid,uuid,text,text,text,text,text) from public, anon, authenticated;
grant execute on function public.complete_shiprocket_creation(uuid,uuid,text,text,text,text,text) to authenticated;

revoke all on function public.release_shiprocket_creation(uuid,uuid,text) from public, anon, authenticated;
grant execute on function public.release_shiprocket_creation(uuid,uuid,text) to authenticated;

-- Admin RPCs: authenticated execution is retained because each function calls
-- require_admin_actor()/assert_admin_role() internally.
revoke all on function public.require_admin_actor() from public, anon, authenticated;
grant execute on function public.require_admin_actor() to authenticated;

revoke all on function public.record_admin_audit(text,text,text,jsonb,text) from public, anon, authenticated;
grant execute on function public.record_admin_audit(text,text,text,jsonb,text) to authenticated;

revoke all on function public.admin_create_product(text,text,text,text,uuid,uuid,numeric,numeric,text,text[],text) from public, anon, authenticated;
grant execute on function public.admin_create_product(text,text,text,text,uuid,uuid,numeric,numeric,text,text[],text) to authenticated;

revoke all on function public.admin_update_product(uuid,text,text,text,text,uuid,uuid,numeric,numeric,text,text[],text,boolean,text) from public, anon, authenticated;
grant execute on function public.admin_update_product(uuid,text,text,text,text,uuid,uuid,numeric,numeric,text,text[],text,boolean,text) to authenticated;

revoke all on function public.admin_archive_product(uuid) from public, anon, authenticated;
grant execute on function public.admin_archive_product(uuid) to authenticated;

revoke all on function public.admin_create_category(text,text,text,text) from public, anon, authenticated;
grant execute on function public.admin_create_category(text,text,text,text) to authenticated;

revoke all on function public.admin_update_category(uuid,text,text,text,text,boolean) from public, anon, authenticated;
grant execute on function public.admin_update_category(uuid,text,text,text,text,boolean) to authenticated;

revoke all on function public.admin_adjust_inventory(uuid,integer,text) from public, anon, authenticated;
grant execute on function public.admin_adjust_inventory(uuid,integer,text) to authenticated;

revoke all on function public.admin_cancel_order(uuid,text) from public, anon, authenticated;
grant execute on function public.admin_cancel_order(uuid,text) to authenticated;

revoke all on function public.admin_create_promotion(text,text,text,text,numeric,numeric,numeric,timestamptz,timestamptz,integer,integer,text,uuid[],uuid[],boolean) from public, anon, authenticated;
grant execute on function public.admin_create_promotion(text,text,text,text,numeric,numeric,numeric,timestamptz,timestamptz,integer,integer,text,uuid[],uuid[],boolean) to authenticated;

revoke all on function public.admin_update_promotion(uuid,text,text,text,text,numeric,numeric,numeric,timestamptz,timestamptz,integer,integer,text,uuid[],uuid[],boolean) from public, anon, authenticated;
grant execute on function public.admin_update_promotion(uuid,text,text,text,text,numeric,numeric,numeric,timestamptz,timestamptz,integer,integer,text,uuid[],uuid[],boolean) to authenticated;

-- Analytics is authenticated-admin only; the function itself also checks the
-- authenticated actor through require_admin_actor().
revoke all on function public.get_analytics_summary(timestamptz,timestamptz) from public, anon, authenticated;
grant execute on function public.get_analytics_summary(timestamptz,timestamptz) to authenticated;

-- Payment mutation/verification helpers are server-side only.
revoke all on function public.attach_provider_order(uuid,text) from public, anon, authenticated;
revoke all on function public.finalize_razorpay_payment(uuid,text,text,bigint,text,boolean,text) from public, anon, authenticated;
revoke all on function public.record_razorpay_inventory_exception(uuid,text,text) from public, anon, authenticated;
revoke all on function public.record_razorpay_failure(uuid,text,text) from public, anon, authenticated;
grant execute on function public.attach_provider_order(uuid,text) to service_role;
grant execute on function public.finalize_razorpay_payment(uuid,text,text,bigint,text,boolean,text) to service_role;
grant execute on function public.record_razorpay_inventory_exception(uuid,text,text) to service_role;
grant execute on function public.record_razorpay_failure(uuid,text,text) to service_role;

-- Durable Razorpay webhook lifecycle is service-role only.
revoke all on function public.claim_razorpay_webhook_event(text,text,jsonb,boolean) from public, anon, authenticated;
grant execute on function public.claim_razorpay_webhook_event(text,text,jsonb,boolean) to service_role;
revoke all on function public.complete_razorpay_webhook_event(uuid,uuid) from public, anon, authenticated;
grant execute on function public.complete_razorpay_webhook_event(uuid,uuid) to service_role;
revoke all on function public.release_razorpay_webhook_event(uuid,uuid) from public, anon, authenticated;
grant execute on function public.release_razorpay_webhook_event(uuid,uuid) to service_role;

-- Shiprocket webhook processing is service-role only.
revoke all on function public.record_shiprocket_webhook(text,jsonb,text,text,text,text,text) from public, anon, authenticated;
grant execute on function public.record_shiprocket_webhook(text,jsonb,text,text,text,text,text) to service_role;

-- Notification delivery worker is service-role only.
revoke all on function public.notification_recipient_email(uuid) from public, anon, authenticated;
revoke all on function public.notification_insert(text,uuid,uuid,text,text,jsonb) from public, anon, authenticated;
revoke all on function public.build_order_notification_payload(uuid) from public, anon, authenticated;
revoke all on function public.build_fulfillment_notification_payload(uuid) from public, anon, authenticated;
revoke all on function public.claim_notification_delivery(uuid) from public, anon, authenticated;
revoke all on function public.complete_notification_delivery(uuid,uuid,text,text) from public, anon, authenticated;
revoke all on function public.fail_notification_delivery(uuid,uuid,text,text,text,text) from public, anon, authenticated;
grant execute on function public.notification_recipient_email(uuid) to service_role;
grant execute on function public.notification_insert(text,uuid,uuid,text,text,jsonb) to service_role;
grant execute on function public.build_order_notification_payload(uuid) to service_role;
grant execute on function public.build_fulfillment_notification_payload(uuid) to service_role;
grant execute on function public.claim_notification_delivery(uuid) to service_role;
grant execute on function public.complete_notification_delivery(uuid,uuid,text,text) to service_role;
grant execute on function public.fail_notification_delivery(uuid,uuid,text,text,text,text) to service_role;

-- These functions are invoked by triggers and/or trusted server code only.
revoke all on function public.notification_order_state_trigger() from public, anon, authenticated;
revoke all on function public.notification_fulfillment_state_trigger() from public, anon, authenticated;

-- Promotion calculation is an internal helper. Preview uses the guarded wrapper;
-- final checkout invokes it internally with p_lock=true.
revoke all on function public.calculate_promotion_for_lines(text,uuid,numeric,jsonb,boolean) from public, anon, authenticated;

-- Catalog availability is intentionally public/read-only and is not changed here.
