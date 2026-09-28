import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Card } from "@/components/ui/card";
import { Plus, Pencil, Trash2, CalendarDays, MapPin, FileText } from "lucide-react";
import { toast } from "sonner";
import type { Tables } from "@/integrations/supabase/types";
import { useRoles } from "@/hooks/use-roles";
import { notifyNewMeeting } from "@/lib/notifications";

export const Route = createFileRoute("/_authenticated/meetings")({
  component: Page,
});

/** A meeting row with its minutes embedded. */
type MeetingRow = Tables<"meetings"> & { meeting_minutes?: Tables<"meeting_minutes">[] };

/** Convert an ISO timestamp to the `YYYY-MM-DDTHH:mm` shape datetime-local wants. */
function toLocalInputValue(iso: string) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const offset = date.getTimezoneOffset() * 60000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

function Page() {
  const { user } = Route.useRouteContext();
  const r = useRoles(user.id);
  const qc = useQueryClient();

  const { data: meetings = [], isLoading } = useQuery({
    queryKey: ["meetings"],
    queryFn: async () => {
      try {
        const { data, error } = await supabase
          .from("meetings")
          .select("*, meeting_minutes(*)")
          .order("scheduled_for", { ascending: false });
        if (error) throw error;
        return (data ?? []) as MeetingRow[];
      } catch (error) {
        console.error("Failed to load meetings", error);
        toast.error("Could not load meetings.");
        return [];
      }
    },
  });

  const [open, setOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState({ title: "", scheduled_for: "", location: "", agenda: "" });

  const closeDialog = () => {
    setOpen(false);
    setEditingId(null);
    setForm({ title: "", scheduled_for: "", location: "", agenda: "" });
  };

  const startEdit = (meeting: (typeof meetings)[number]) => {
    setEditingId(meeting.id);
    setForm({
      title: meeting.title,
      // datetime-local expects a local "YYYY-MM-DDTHH:mm" value.
      scheduled_for: toLocalInputValue(meeting.scheduled_for),
      location: meeting.location ?? "",
      agenda: meeting.agenda ?? "",
    });
    setOpen(true);
  };

  const save = useMutation({
    mutationFn: async () => {
      if (!form.title.trim()) throw new Error("Title is required.");
      const scheduledIso = new Date(form.scheduled_for).toISOString();
      if (Number.isNaN(new Date(scheduledIso).getTime()))
        throw new Error("Pick a valid date and time.");

      const payload = {
        title: form.title,
        scheduled_for: scheduledIso,
        location: form.location || null,
        agenda: form.agenda || null,
      };

      if (editingId) {
        const { error } = await supabase.from("meetings").update(payload).eq("id", editingId);
        if (error) throw error;
        return;
      }

      const { error } = await supabase.from("meetings").insert({
        ...payload,
        created_by: user.id,
      });
      if (error) throw error;

      notifyNewMeeting({
        title: form.title,
        scheduledFor: scheduledIso,
        location: form.location || undefined,
        agenda: form.agenda || undefined,
      }).catch((e) => console.warn("Failed broadcasting meeting notification", e));
    },
    onSuccess: () => {
      toast.success(editingId ? "Meeting updated." : "Meeting scheduled. All members can see it.");
      closeDialog();
      void qc.invalidateQueries({ queryKey: ["meetings"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const del = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("meetings").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Meeting deleted");
      void qc.invalidateQueries({ queryKey: ["meetings"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const [minutesOpen, setMinutesOpen] = useState<string | null>(null);
  const [minutesText, setMinutesText] = useState("");

  const addMinutes = useMutation({
    mutationFn: async (meeting_id: string) => {
      const { error } = await supabase.from("meeting_minutes").insert({
        meeting_id,
        content: minutesText,
        recorded_by: user.id,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Minutes saved");
      setMinutesOpen(null);
      setMinutesText("");
      void qc.invalidateQueries({ queryKey: ["meetings"] });
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
        {r.isSecretariat && (
          <Dialog open={open} onOpenChange={(next) => (next ? setOpen(true) : closeDialog())}>
            <DialogTrigger asChild>
              <Button
                onClick={() => {
                  setEditingId(null);
                  setForm({ title: "", scheduled_for: "", location: "", agenda: "" });
                  setOpen(true);
                }}
              >
                <Plus className="mr-2 h-4 w-4" /> New Meeting
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle className="font-serif">
                  {editingId ? "Edit meeting" : "New meeting"}
                </DialogTitle>
              </DialogHeader>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  save.mutate();
                }}
                className="space-y-3"
              >
                <div>
                  <Label>Title</Label>
                  <Input
                    required
                    value={form.title}
                    onChange={(e) => setForm({ ...form, title: e.target.value })}
                  />
                </div>
                <div>
                  <Label>Date & time</Label>
                  <Input
                    type="datetime-local"
                    required
                    value={form.scheduled_for}
                    onChange={(e) => setForm({ ...form, scheduled_for: e.target.value })}
                  />
                </div>
                <div>
                  <Label>Location</Label>
                  <Input
                    value={form.location}
                    onChange={(e) => setForm({ ...form, location: e.target.value })}
                  />
                </div>
                <div>
                  <Label>Agenda</Label>
                  <Textarea
                    rows={4}
                    value={form.agenda}
                    onChange={(e) => setForm({ ...form, agenda: e.target.value })}
                  />
                </div>
                <DialogFooter>
                  <Button type="submit" disabled={save.isPending}>
                    {save.isPending ? "Saving…" : editingId ? "Save changes" : "Notify members"}
                  </Button>
                </DialogFooter>
              </form>
            </DialogContent>
          </Dialog>
        )}
      </div>

      {isLoading ? (
        <div className="text-sm text-muted-foreground">Loading…</div>
      ) : meetings.length === 0 ? (
        <Card className="p-8 text-center text-muted-foreground">No meetings scheduled.</Card>
      ) : (
        meetings.map((m) => {
          const minutes = m.meeting_minutes ?? [];
          const upcoming = new Date(m.scheduled_for) > new Date();
          return (
            <Card key={m.id} className="p-5">
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <h3 className="font-serif text-lg font-semibold">{m.title}</h3>
                    {upcoming && (
                      <span className="rounded-full bg-gold/20 px-2 py-0.5 text-[10px] uppercase tracking-wider text-gold">
                        Upcoming
                      </span>
                    )}
                  </div>
                  <div className="mt-1 flex flex-wrap gap-3 text-xs text-muted-foreground">
                    <span className="flex items-center gap-1">
                      <CalendarDays className="h-3 w-3" />
                      {new Date(m.scheduled_for).toLocaleString()}
                    </span>
                    {m.location && (
                      <span className="flex items-center gap-1">
                        <MapPin className="h-3 w-3" />
                        {m.location}
                      </span>
                    )}
                  </div>
                  {m.agenda && <p className="mt-3 whitespace-pre-wrap text-sm">{m.agenda}</p>}
                  {minutes.length > 0 && (
                    <div className="mt-4 space-y-2 border-t border-border pt-3">
                      <div className="flex items-center gap-1 text-xs font-medium uppercase tracking-wider text-muted-foreground">
                        <FileText className="h-3 w-3" /> Minutes
                      </div>
                      {minutes.map((mm) => (
                        <div key={mm.id} className="rounded-md bg-muted/40 p-3 text-sm">
                          <div className="text-[10px] text-muted-foreground">
                            {new Date(mm.created_at).toLocaleString()}
                          </div>
                          <div className="mt-1 whitespace-pre-wrap">{mm.content}</div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
                <div className="flex shrink-0 flex-wrap justify-end gap-2">
                  {r.isSecretariat && (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={save.isPending || del.isPending}
                      onClick={() => startEdit(m)}
                    >
                      <Pencil className="mr-1 h-3.5 w-3.5" /> Edit
                    </Button>
                  )}
                  {r.isSecretariat && (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={addMinutes.isPending}
                      onClick={() => {
                        setMinutesOpen(m.id);
                        setMinutesText("");
                      }}
                    >
                      Add minutes
                    </Button>
                  )}
                  {r.isAdmin && (
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={del.isPending}
                      onClick={() => {
                        if (confirm(`Delete "${m.title}"?`)) del.mutate(m.id);
                      }}
                    >
                      <Trash2 className="mr-1 h-3.5 w-3.5 text-destructive" /> Delete
                    </Button>
                  )}
                </div>
              </div>
            </Card>
          );
        })
      )}

      <Dialog open={!!minutesOpen} onOpenChange={(o) => !o && setMinutesOpen(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="font-serif">Record minutes</DialogTitle>
          </DialogHeader>
          <Textarea
            rows={10}
            value={minutesText}
            onChange={(e) => setMinutesText(e.target.value)}
            placeholder="What was discussed and decided…"
          />
          <DialogFooter>
            <Button
              disabled={!minutesText || addMinutes.isPending}
              onClick={() => minutesOpen && addMinutes.mutate(minutesOpen)}
            >
              {addMinutes.isPending ? "Saving…" : "Save minutes"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
