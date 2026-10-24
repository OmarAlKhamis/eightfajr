import { ThumbsDown, ThumbsUp } from "lucide-react";
import { useState } from "react";
import { useI18n } from "@/i18n";
import { useFeedback } from "@/lib/api";
import { track } from "@/lib/analytics";
import { Button } from "./ui";

export function FeedbackWidget({ page }: { page: string }) {
  const { t, locale } = useI18n();
  const [rating, setRating] = useState<"up" | "down" | null>(null);
  const [comment, setComment] = useState("");
  const [done, setDone] = useState(false);
  const fb = useFeedback();

  if (done) return <p className="text-sm text-muted text-center py-2">{t.feedback.thanks}</p>;

  const send = (r: "up" | "down", c: string) =>
    fb.mutate(
      { rating: r, comment: c || undefined, page, locale },
      {
        onSuccess: () => {
          setDone(true);
          track("feedback_sent", { rating: r, has_comment: !!c, page });
        },
      },
    );

  return (
    <div className="rounded-2xl border border-dashed border-line p-4 text-center space-y-3">
      <p className="text-sm font-semibold">{t.feedback.title}</p>
      {!rating ? (
        <div className="flex justify-center gap-3">
          <Button variant="secondary" size="sm" onClick={() => setRating("up")} aria-label="👍">
            <ThumbsUp className="size-4" />
          </Button>
          <Button variant="secondary" size="sm" onClick={() => setRating("down")} aria-label="👎">
            <ThumbsDown className="size-4" />
          </Button>
        </div>
      ) : (
        <div className="space-y-2">
          <textarea
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            placeholder={t.feedback.comment}
            rows={2}
            maxLength={1000}
            className="w-full rounded-xl border border-line bg-app px-3 py-2 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-dawn-400"
          />
          <div className="flex justify-center gap-2">
            <Button size="sm" onClick={() => send(rating, comment.trim())} loading={fb.isPending}>
              {t.feedback.send}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setRating(null)}>
              {t.common.cancel}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
