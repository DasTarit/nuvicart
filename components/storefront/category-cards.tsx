import Image from "next/image";
import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { listCategories } from "@/features/catalog/service";

export async function CategoryCards() {
  const categories = await listCategories();
  return <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
    {categories.map((category) => <Link key={category.slug} href={`/category/${category.slug}`} className="group relative overflow-hidden rounded-2xl bg-surface-muted">
      {category.imageUrl && <Image src={category.imageUrl} alt="" width={900} height={900} className="aspect-[4/5] w-full object-cover transition duration-500 group-hover:scale-105" />}
      <div className="absolute inset-0 bg-gradient-to-t from-black/65 via-black/5 to-transparent"/>
      <div className="absolute inset-x-4 bottom-4 text-white"><div className="flex items-end justify-between gap-2"><div><h3 className="font-semibold">{category.name}</h3><p className="mt-1 text-xs text-white/75">{category.description}</p></div><ArrowUpRight className="transition-transform group-hover:translate-x-1 group-hover:-translate-y-1" size={18}/></div></div>
    </Link>)}
  </div>;
}
