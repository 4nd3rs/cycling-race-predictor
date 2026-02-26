import { redirect } from "next/navigation";
import { isValidDiscipline } from "@/lib/url-utils";

interface PageProps {
  params: Promise<{ discipline: string }>;
}

export default async function DisciplinePage({ params }: PageProps) {
  const { discipline } = await params;
  if (!isValidDiscipline(discipline)) {
    redirect("/races");
  }
  redirect(`/races?d=${discipline}`);
}
