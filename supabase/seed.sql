-- Deterministic Nuvicart development catalog for a non-production Supabase project.
-- Run migrations before this file. Re-running the seed updates the known demo
-- records without generating duplicate products, variants or images.

insert into public.categories(name, slug, description, image_url, is_active, sort_order)
values
  ('Electronics','electronics','Smart tech for everyday life.','https://images.unsplash.com/photo-1505740420928-5e560c06d30e?auto=format&fit=crop&w=900&q=85',true,10),
  ('Fashion','fashion','Modern pieces, easy to wear.','https://images.unsplash.com/photo-1542291026-7eec264c27ff?auto=format&fit=crop&w=900&q=85',true,20),
  ('Gaming','gaming','Gear up and play better.','https://images.unsplash.com/photo-1587829741301-dc798b83add3?auto=format&fit=crop&w=900&q=85',true,30),
  ('Home & Living','home-living','Make your space feel yours.','https://images.unsplash.com/photo-1507473885765-e6ed057f782c?auto=format&fit=crop&w=900&q=85',true,40),
  ('Beauty & Personal Care','beauty-personal-care','Everyday essentials, elevated.','https://images.unsplash.com/photo-1556229010-6c3f2c9ca5f8?auto=format&fit=crop&w=900&q=85',true,50),
  ('Lifestyle','lifestyle','Small upgrades, better days.','https://images.unsplash.com/photo-1523275335684-37898b6baf30?auto=format&fit=crop&w=900&q=85',true,60),
  ('Accessories','accessories','The finishing touch.','https://images.unsplash.com/photo-1548036328-c9fa89d128fa?auto=format&fit=crop&w=900&q=85',true,70),
  ('Stationery','stationery','Tools for ideas in motion.','https://images.unsplash.com/photo-1587829741301-dc798b83add3?auto=format&fit=crop&w=900&q=85',true,80)
on conflict (slug) do update set
  name = excluded.name,
  description = excluded.description,
  image_url = excluded.image_url,
  is_active = excluded.is_active,
  sort_order = excluded.sort_order;

insert into public.brands(name, slug, description, logo_url, is_active)
values
  ('Auralab','auralab','Fictional audio products for Nuvicart development.','https://dummyimage.com/160x80/111827/ffffff&text=Auralab',true),
  ('Nuvix','nuvix','Fictional smart devices for Nuvicart development.','https://dummyimage.com/160x80/111827/ffffff&text=Nuvix',true),
  ('Frame','frame','Fictional creator hardware for Nuvicart development.','https://dummyimage.com/160x80/111827/ffffff&text=Frame',true),
  ('Northline','northline','Fictional everyday fashion for Nuvicart development.','https://dummyimage.com/160x80/111827/ffffff&text=Northline',true),
  ('Luma','luma','Fictional home lighting for Nuvicart development.','https://dummyimage.com/160x80/111827/ffffff&text=Luma',true),
  ('Keyform','keyform','Fictional gaming peripherals for Nuvicart development.','https://dummyimage.com/160x80/111827/ffffff&text=Keyform',true),
  ('Mira','mira','Fictional personal-care products for Nuvicart development.','https://dummyimage.com/160x80/111827/ffffff&text=Mira',true),
  ('Aster','aster','Fictional accessories for Nuvicart development.','https://dummyimage.com/160x80/111827/ffffff&text=Aster',true)
on conflict (slug) do update set
  name = excluded.name,
  description = excluded.description,
  logo_url = excluded.logo_url,
  is_active = excluded.is_active;

insert into public.products
  (category_id, brand_id, slug, name, short_description, description, price, compare_at_price,
   original_price, status, is_featured, is_active, rating, review_count, stock, tags, sku, legacy_id)
select
  c.id, b.id, x.slug, x.name, x.short_description, x.description, x.price, x.compare_at_price,
  x.compare_at_price, 'active', x.is_featured, true, x.rating, x.review_count, x.stock, x.tags, x.sku, x.legacy_id
from (values
  ('electronics','auralab','nova-pro-headphones','Nova Pro Wireless','Immersive wireless audio with adaptive noise control.','Immersive wireless audio with adaptive noise control and all-day comfort.',8999.00,10999.00,true,4.8,214,18,'{audio,wireless,headphones}', 'NUV-AUR-NOVA','p1'),
  ('electronics','nuvix','orbit-smartwatch','Orbit Smartwatch','A refined everyday smartwatch with health insights.','A refined everyday smartwatch with health insights, notifications and a bright AMOLED display.',6499.00,7999.00,true,4.6,148,12,'{watch,wearable,smart}', 'NUV-NVX-ORBIT','p2'),
  ('electronics','frame','frame-x-camera','Frame X Mirrorless','Compact mirrorless performance for creators.','Compact mirrorless performance designed for creators who want cinematic detail without the bulk.',54999.00,null,true,4.9,83,6,'{camera,creator,photography}', 'NUV-FRM-X','p3'),
  ('fashion','northline','velocity-runner','Velocity Runner','Lightweight everyday sneakers built for movement.','Lightweight everyday sneakers built for movement, errands and weekend plans.',3299.00,4299.00,true,4.5,321,28,'{sneakers,shoes,fashion}', 'NUV-NOR-VEL','p4'),
  ('home-living','luma','arc-desk-lamp','Arc Desk Lamp','Minimal task lighting for focused workspaces.','Minimal task lighting with a sculptural silhouette for focused workspaces.',2499.00,2999.00,true,4.7,94,20,'{lamp,desk,home}', 'NUV-LUM-ARC','p5'),
  ('gaming','keyform','flux-mechanical-keyboard','Flux Mechanical Keyboard','A compact hot-swappable mechanical keyboard.','Hot-swappable mechanical switches, compact layout and a crisp tactile feel.',5799.00,6499.00,true,4.8,176,15,'{keyboard,gaming,mechanical}', 'NUV-KEY-FLX','p6'),
  ('beauty-personal-care','mira','daily-glow-set','Daily Glow Set','A simple daily-care set for a fresh routine.','A simple daily-care set for a fresh, comfortable routine.',1899.00,2299.00,true,4.4,67,24,'{beauty,skincare,care}', 'NUV-MIR-GLOW','p7'),
  ('accessories','aster','metro-crossbody','Metro Crossbody','A compact crossbody for everyday essentials.','A compact crossbody with considered storage for everyday essentials.',2199.00,null,true,4.6,112,31,'{bag,accessories,lifestyle}', 'NUV-AST-METRO','p8')
) as x(category_slug,brand_slug,slug,name,short_description,description,price,compare_at_price,is_featured,rating,review_count,stock,tags,sku,legacy_id)
join public.categories c on c.slug=x.category_slug
join public.brands b on b.slug=x.brand_slug
on conflict (slug) do update set
  category_id=excluded.category_id,
  brand_id=excluded.brand_id,
  name=excluded.name,
  short_description=excluded.short_description,
  description=excluded.description,
  price=excluded.price,
  compare_at_price=excluded.compare_at_price,
  original_price=excluded.original_price,
  status=excluded.status,
  is_featured=excluded.is_featured,
  is_active=excluded.is_active,
  rating=excluded.rating,
  review_count=excluded.review_count,
  stock=excluded.stock,
  tags=excluded.tags,
  sku=excluded.sku,
  legacy_id=excluded.legacy_id;

insert into public.product_images(product_id,url,alt_text,sort_order,is_primary)
select p.id, x.url, x.alt_text, x.sort_order, x.is_primary
from (values
  ('nova-pro-headphones','https://images.unsplash.com/photo-1505740420928-5e560c06d30e?auto=format&fit=crop&w=900&q=85','Nova Pro Wireless headphones',0,true),
  ('nova-pro-headphones','https://images.unsplash.com/photo-1516035069371-29a1b244cc32?auto=format&fit=crop&w=900&q=85','Nova Pro Wireless alternate view',1,false),
  ('orbit-smartwatch','https://images.unsplash.com/photo-1523275335684-37898b6baf30?auto=format&fit=crop&w=900&q=85','Orbit Smartwatch',0,true),
  ('orbit-smartwatch','https://images.unsplash.com/photo-1507473885765-e6ed057f782c?auto=format&fit=crop&w=900&q=85','Orbit Smartwatch alternate view',1,false),
  ('frame-x-camera','https://images.unsplash.com/photo-1516035069371-29a1b244cc32?auto=format&fit=crop&w=900&q=85','Frame X Mirrorless camera',0,true),
  ('frame-x-camera','https://images.unsplash.com/photo-1505740420928-5e560c06d30e?auto=format&fit=crop&w=900&q=85','Frame X alternate view',1,false),
  ('velocity-runner','https://images.unsplash.com/photo-1542291026-7eec264c27ff?auto=format&fit=crop&w=900&q=85','Velocity Runner sneakers',0,true),
  ('velocity-runner','https://images.unsplash.com/photo-1548036328-c9fa89d128fa?auto=format&fit=crop&w=900&q=85','Velocity Runner alternate view',1,false),
  ('arc-desk-lamp','https://images.unsplash.com/photo-1507473885765-e6ed057f782c?auto=format&fit=crop&w=900&q=85','Arc Desk Lamp',0,true),
  ('arc-desk-lamp','https://images.unsplash.com/photo-1523275335684-37898b6baf30?auto=format&fit=crop&w=900&q=85','Arc Desk Lamp alternate view',1,false),
  ('flux-mechanical-keyboard','https://images.unsplash.com/photo-1587829741301-dc798b83add3?auto=format&fit=crop&w=900&q=85','Flux Mechanical Keyboard',0,true),
  ('flux-mechanical-keyboard','https://images.unsplash.com/photo-1516035069371-29a1b244cc32?auto=format&fit=crop&w=900&q=85','Flux Mechanical Keyboard alternate view',1,false),
  ('daily-glow-set','https://images.unsplash.com/photo-1556229010-6c3f2c9ca5f8?auto=format&fit=crop&w=900&q=85','Daily Glow Set',0,true),
  ('daily-glow-set','https://images.unsplash.com/photo-1507473885765-e6ed057f782c?auto=format&fit=crop&w=900&q=85','Daily Glow Set alternate view',1,false),
  ('metro-crossbody','https://images.unsplash.com/photo-1548036328-c9fa89d128fa?auto=format&fit=crop&w=900&q=85','Metro Crossbody',0,true),
  ('metro-crossbody','https://images.unsplash.com/photo-1542291026-7eec264c27ff?auto=format&fit=crop&w=900&q=85','Metro Crossbody alternate view',1,false)
) as x(slug,url,alt_text,sort_order,is_primary)
join public.products p on p.slug=x.slug
on conflict (product_id, sort_order) do update set
  url=excluded.url, alt_text=excluded.alt_text, is_primary=excluded.is_primary;

insert into public.product_variants(product_id,sku,name,option_values,price_override,is_active)
select p.id,x.sku,x.name,x.option_values::jsonb,x.price_override,true
from (values
  ('nova-pro-headphones','NUV-AUR-NOVA-BLK','Black','{"color":"Black"}',null),
  ('nova-pro-headphones','NUV-AUR-NOVA-WHT','White','{"color":"White"}',null),
  ('velocity-runner','NUV-NOR-VEL-8','Size 8','{"size":"8"}',null),
  ('velocity-runner','NUV-NOR-VEL-9','Size 9','{"size":"9"}',null),
  ('velocity-runner','NUV-NOR-VEL-10','Size 10','{"size":"10"}',null),
  ('flux-mechanical-keyboard','NUV-KEY-FLX-BLK','Black','{"color":"Black"}',null),
  ('flux-mechanical-keyboard','NUV-KEY-FLX-WHT','White','{"color":"White"}',null)
) as x(slug,sku,name,option_values,price_override)
join public.products p on p.slug=x.slug
on conflict (sku) do update set
  product_id=excluded.product_id,
  name=excluded.name,
  option_values=excluded.option_values,
  price_override=excluded.price_override,
  is_active=excluded.is_active;

-- Variant-level inventory is preferred whenever a product has active variants.
insert into public.inventory(variant_id,stock_quantity,reserved_quantity)
select v.id,x.stock_quantity,0
from (values
  ('NUV-AUR-NOVA-BLK',10),
  ('NUV-AUR-NOVA-WHT',8),
  ('NUV-NOR-VEL-8',10),
  ('NUV-NOR-VEL-9',9),
  ('NUV-NOR-VEL-10',9),
  ('NUV-KEY-FLX-BLK',8),
  ('NUV-KEY-FLX-WHT',7)
) as x(sku,stock_quantity)
join public.product_variants v on v.sku=x.sku
on conflict (variant_id) do update set
  stock_quantity=excluded.stock_quantity,
  reserved_quantity=0;

-- Products without active variants use one product-level inventory record.
insert into public.inventory(product_id,stock_quantity,reserved_quantity)
select p.id,x.stock_quantity,0
from (values
  ('orbit-smartwatch',12),
  ('frame-x-camera',6),
  ('arc-desk-lamp',20),
  ('daily-glow-set',24),
  ('metro-crossbody',31)
) as x(slug,stock_quantity)
join public.products p on p.slug=x.slug
on conflict (product_id) do update set
  stock_quantity=excluded.stock_quantity,
  reserved_quantity=0;
