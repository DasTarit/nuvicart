import type { Product } from "./types";

const images = {
  headphones: "https://images.unsplash.com/photo-1505740420928-5e560c06d30e?auto=format&fit=crop&w=900&q=85",
  watch: "https://images.unsplash.com/photo-1523275335684-37898b6baf30?auto=format&fit=crop&w=900&q=85",
  camera: "https://images.unsplash.com/photo-1516035069371-29a1b244cc32?auto=format&fit=crop&w=900&q=85",
  sneaker: "https://images.unsplash.com/photo-1542291026-7eec264c27ff?auto=format&fit=crop&w=900&q=85",
  lamp: "https://images.unsplash.com/photo-1507473885765-e6ed057f782c?auto=format&fit=crop&w=900&q=85",
  keyboard: "https://images.unsplash.com/photo-1587829741301-dc798b83add3?auto=format&fit=crop&w=900&q=85",
  skincare: "https://images.unsplash.com/photo-1556229010-6c3f2c9ca5f8?auto=format&fit=crop&w=900&q=85",
  bag: "https://images.unsplash.com/photo-1548036328-c9fa89d128fa?auto=format&fit=crop&w=900&q=85",
};

export const demoProducts: Product[] = [
  { id:"p1", slug:"nova-pro-headphones", name:"Nova Pro Wireless", brand:"Auralab", category:"Electronics", categorySlug:"electronics", price:8999, originalPrice:10999, rating:4.8, reviews:214, stock:18, badge:"Bestseller", description:"Immersive wireless audio with adaptive noise control and all-day comfort.", image:images.headphones, secondaryImage:images.camera, tags:["audio","wireless","headphones"], requiresVariantSelection:false },
  { id:"p2", slug:"orbit-smartwatch", name:"Orbit Smartwatch", brand:"Nuvix", category:"Electronics", categorySlug:"electronics", price:6499, originalPrice:7999, rating:4.6, reviews:148, stock:12, badge:"New", description:"A refined everyday smartwatch with health insights, notifications and a bright AMOLED display.", image:images.watch, secondaryImage:images.lamp, tags:["watch","wearable","smart"], requiresVariantSelection:false },
  { id:"p3", slug:"frame-x-camera", name:"Frame X Mirrorless", brand:"Frame", category:"Electronics", categorySlug:"electronics", price:54999, rating:4.9, reviews:83, stock:6, badge:"Limited", description:"Compact mirrorless performance designed for creators who want cinematic detail without the bulk.", image:images.camera, secondaryImage:images.headphones, tags:["camera","creator","photography"], requiresVariantSelection:false },
  { id:"p4", slug:"velocity-runner", name:"Velocity Runner", brand:"Northline", category:"Fashion", categorySlug:"fashion", price:3299, originalPrice:4299, rating:4.5, reviews:321, stock:28, badge:"Deal", description:"Lightweight everyday sneakers built for movement, errands and weekend plans.", image:images.sneaker, secondaryImage:images.bag, tags:["sneakers","shoes","fashion"], requiresVariantSelection:false },
  { id:"p5", slug:"arc-desk-lamp", name:"Arc Desk Lamp", brand:"Luma", category:"Home & Living", categorySlug:"home-living", price:2499, originalPrice:2999, rating:4.7, reviews:94, stock:20, badge:"New", description:"Minimal task lighting with a sculptural silhouette for focused workspaces.", image:images.lamp, secondaryImage:images.watch, tags:["lamp","desk","home"], requiresVariantSelection:false },
  { id:"p6", slug:"flux-mechanical-keyboard", name:"Flux Mechanical Keyboard", brand:"Keyform", category:"Gaming", categorySlug:"gaming", price:5799, originalPrice:6499, rating:4.8, reviews:176, stock:15, badge:"Bestseller", description:"Hot-swappable mechanical switches, compact layout and a crisp tactile feel.", image:images.keyboard, secondaryImage:images.camera, tags:["keyboard","gaming","mechanical"], requiresVariantSelection:false },
  { id:"p7", slug:"daily-glow-set", name:"Daily Glow Set", brand:"Mira", category:"Beauty & Personal Care", categorySlug:"beauty-personal-care", price:1899, originalPrice:2299, rating:4.4, reviews:67, stock:24, badge:"Deal", description:"A simple daily-care set for a fresh, comfortable routine.", image:images.skincare, secondaryImage:images.lamp, tags:["beauty","skincare","care"], requiresVariantSelection:false },
  { id:"p8", slug:"metro-crossbody", name:"Metro Crossbody", brand:"Aster", category:"Accessories", categorySlug:"accessories", price:2199, rating:4.6, reviews:112, stock:31, description:"A compact crossbody with considered storage for everyday essentials.", image:images.bag, secondaryImage:images.sneaker, tags:["bag","accessories","lifestyle"], requiresVariantSelection:false },
];

export const categories = [
  { name:"Electronics", slug:"electronics", description:"Smart tech for everyday life.", image:images.headphones },
  { name:"Fashion", slug:"fashion", description:"Modern pieces, easy to wear.", image:images.sneaker },
  { name:"Gaming", slug:"gaming", description:"Gear up and play better.", image:images.keyboard },
  { name:"Home & Living", slug:"home-living", description:"Make your space feel yours.", image:images.lamp },
  { name:"Beauty & Personal Care", slug:"beauty-personal-care", description:"Everyday essentials, elevated.", image:images.skincare },
  { name:"Lifestyle", slug:"lifestyle", description:"Small upgrades, better days.", image:images.watch },
  { name:"Accessories", slug:"accessories", description:"The finishing touch.", image:images.bag },
  { name:"Stationery", slug:"stationery", description:"Tools for ideas in motion.", image:images.keyboard },
] as const;
