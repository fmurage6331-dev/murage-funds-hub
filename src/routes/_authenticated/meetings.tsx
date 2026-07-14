import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Card } from "@/components/ui/card";
import { Plus, CalendarDays, MapPin, FileText } from "lucide-react";
import { toast } from "sonner";
import { useRoles } from "@/hooks/use-roles";

export const Route = createFileRoute("/_authenticated/meetings")({
  component: Page,
});

function Page() {
  const { user } = Route.useRouteContext();
  const r = useRoles(user.id);
  const qc = useQueryClient();

  const { data: meetings = [], isLoading } = useQuery({
    queryKey: ["meetings"],
    queryFn: async () => (await supabase.from("meetings").select("*, meeting_minutes(*)").order("scheduled_for", { ascending: false })).data ?? [],
  });

  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ title: "", scheduled_for: "", location: "", agenda: "" });

  const create = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from("meetings").insert({
        title: form.title,
        scheduled_for: new Date(form.scheduled_for).toISOString(),
        location: form.location || null,
        agenda: form.agenda || null,
        created_by: user.id,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Meeting scheduled. All members can see it.");
      setOpen(false);
      setForm({ title: "", scheduled_for: "", location: "", agenda: "" });
      qc.invalidateQueries({ queryKey: ["meetings"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const [minutesOpen, setMinutesOpen] = useState<string | null>(null);
  const [minutesText, setMinutesText] = useState("");

  const addMinutes = useMutation({
    mutationFn: async (meeting_id: string) => {
      const { error } = await supabase.from("meeting_minutes").insert({
        meeting_id, content: minutesText, recorded_by: user.id,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Minutes saved");
      setMinutesOpen(null); setMinutesText("");
      qc.invalidateQueries({ queryKey: ["meetings"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="font-serif text-2xl font-semibold text-primary">Meetings</h2>
          <p className="text-sm text-muted-foreground">Upcoming meetings, agendas, and minutes.</p>
        </div>
        {r.canManageMeetings && (
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button><Plus className="mr-2 h-4 w-4" /> Schedule meeting</Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader><DialogTitle className="font-serif">New meeting</DialogTitle></DialogHeader>
              <form onSubmit={(e) => { e.preventDefault(); create.mutate(); }} className="space-y-3">
                <div><Label>Title</Label><Input required value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} /></div>
                <div><Label>Date & time</Label><Input type="datetime-local" required value={form.scheduled_for} onChange={(e) => setForm({ ...form, scheduled_for: e.target.value })} /></div>
                <div><Label>Location</Label><Input value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} /></div>
                <div><Label>Agenda</Label><Textarea rows={4} value={form.agenda} onChange={(e) => setForm({ ...form, agenda: e.target.value })} /></div>
                <DialogFooter><Button type="submit" disabled={create.isPending}>{create.isPending ? "Saving…" : "Notify members"}</Button></DialogFooter>
              </form>
            </DialogContent>
          </Dialog>
        )}
      </div>

      {isLoading ? <div className="text-sm text-muted-foreground">Loading…</div> :
       meetings.length === 0 ? <Card className="p-8 text-center text-muted-foreground">No meetings scheduled.</Card> :
       meetings.map((m) => {
        const minutes = ((m as any).meeting_minutes ?? []) as { id: string; content: string; created_at: string }[];
        const upcoming = new Date(m.scheduled_for) > new Date();
        return (
          <Card key={m.id} className="p-5">
            <div className="flex items-start justify-between gap-4">
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <h3 className="font-serif text-lg font-semibold">{m.title}</h3>
                  {upcoming && <span className="rounded-full bg-gold/20 px-2 py-0.5 text-[10px] uppercase tracking-wider text-gold">Upcoming</span>}
                </div>
                <div className="mt-1 flex flex-wrap gap-3 text-xs text-muted-foreground">
                  <span className="flex items-center gap-1"><CalendarDays className="h-3 w-3" />{new Date(m.scheduled_for).toLocaleString()}</span>
                  {m.location && <span className="flex items-center gap-1"><MapPin className="h-3 w-3" />{m.location}</span>}
                </div>
                {m.agenda && <p className="mt-3 whitespace-pre-wrap text-sm">{m.agenda}</p>}
                {minutes.length > 0 && (
                  <div className="mt-4 space-y-2 border-t border-border pt-3">
                    <div className="flex items-center gap-1 text-xs font-medium uppercase tracking-wider text-muted-foreground"><FileText className="h-3 w-3" /> Minutes</div>
                    {minutes.map((mm) => (
                      <div key={mm.id} className="rounded-md bg-muted/40 p-3 text-sm">
                        <div className="text-[10px] text-muted-foreground">{new Date(mm.created_at).toLocaleString()}</div>
                        <div className="mt-1 whitespace-pre-wrap">{mm.content}</div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
              {r.canManageMeetings && (
                <Button size="sm" variant="outline" onClick={() => { setMinutesOpen(m.id); setMinutesText(""); }}>Add minutes</Button>
              )}
            </div>
          </Card>
        );
      })}

      <Dialog open={!!minutesOpen} onOpenChange={(o) => !o && setMinutesOpen(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle className="font-serif">Record minutes</DialogTitle></DialogHeader>
          <Textarea rows={10} value={minutesText} onChange={(e) => setMinutesText(e.target.value)} placeholder="What was discussed and decided…" />
          <DialogFooter>
            <Button disabled={!minutesText || addMinutes.isPending} onClick={() => minutesOpen && addMinutes.mutate(minutesOpen)}>
              {addMinutes.isPending ? "Saving…" : "Save minutes"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
