import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

export function useFavorites() {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  const { data: favoriteIds = [] } = useQuery({
    queryKey: ["favorites", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("favorites")
        .select("concert_id")
        .eq("user_id", user!.id);
      if (error) throw error;
      return data.map((f) => f.concert_id);
    },
  });

  const addFavorite = useMutation({
    mutationFn: async (concertId: string) => {
      const { error } = await supabase
        .from("favorites")
        .insert({ user_id: user!.id, concert_id: concertId });
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["favorites", user?.id] }),
  });

  const removeFavorite = useMutation({
    mutationFn: async (concertId: string) => {
      const { error } = await supabase
        .from("favorites")
        .delete()
        .eq("user_id", user!.id)
        .eq("concert_id", concertId);
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["favorites", user?.id] }),
  });

  const toggleFavorite = (concertId: string) => {
    if (favoriteIds.includes(concertId)) {
      removeFavorite.mutate(concertId);
    } else {
      addFavorite.mutate(concertId);
    }
  };

  return { favoriteIds, toggleFavorite };
}
