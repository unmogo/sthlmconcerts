import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { updateConcert } from "@/lib/api/concerts";
import { ConcertForm, type ConcertFormData } from "./shared/ConcertForm";
import type { Concert, EventType } from "@/types/concert";

interface EditConcertDialogProps {
  concert: Concert;
  onClose: () => void;
}

export function EditConcertDialog({ concert, onClose }: EditConcertDialogProps) {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const handleSubmit = async (data: ConcertFormData) => {
    await updateConcert(concert.id, {
      ...data,
      date: new Date(data.date).toISOString(),
    });
    toast({ title: "Concert updated", description: `${data.artist} updated successfully` });
    queryClient.invalidateQueries({ queryKey: ["concerts"] });
  };

  const initialData: Partial<Concert> = {
    ...concert,
    date: concert.date.slice(0, 16),
  };

  return (
    <ConcertForm
      mode="edit"
      initialData={initialData}
      onSubmit={handleSubmit}
      onClose={onClose}
    />
  );
}
