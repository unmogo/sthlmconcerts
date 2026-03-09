import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { addConcert } from "@/lib/api/concerts";
import { ConcertForm, type ConcertFormData } from "./shared/ConcertForm";

interface AddConcertDialogProps {
  onClose: () => void;
}

export function AddConcertDialog({ onClose }: AddConcertDialogProps) {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const handleSubmit = async (data: ConcertFormData) => {
    await addConcert({
      ...data,
      date: new Date(data.date).toISOString(),
    });
    toast({ title: "Concert added", description: `${data.artist} added successfully` });
    queryClient.invalidateQueries({ queryKey: ["concerts"] });
  };

  return (
    <ConcertForm
      mode="add"
      onSubmit={handleSubmit}
      onClose={onClose}
    />
  );
}
