import { Link, useSearchParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { Search as SearchIcon } from 'lucide-react';
import { Card, EmptyState, Input, PageHeader, PageState } from '@mohandesyar/ui';
import { appApi } from '../../lib/api.js';

interface Result {
  groups: { module: string; provider: string; title: { fa: string }; hits: { entityId: string; title: string; snippet?: string; link: string }[] }[];
}

/** Global search across providers registered by active modules (PostgreSQL-backed; no AI). */
export function Search() {
  const [params, setParams] = useSearchParams();
  const q = params.get('q') ?? '';
  const res = useQuery({ queryKey: ['search', q], queryFn: () => appApi<Result>(`/api/core/search?q=${encodeURIComponent(q)}`), enabled: q.length >= 2 });
  return (
    <>
      <PageHeader title="جست‌وجو" />
      <form
        role="search"
        className="mb-6"
        onSubmit={(e) => {
          e.preventDefault();
          const v = new FormData(e.currentTarget).get('q');
          setParams(v ? { q: String(v) } : {});
        }}
      >
        <label className="sr-only" htmlFor="q">
          عبارت جست‌وجو
        </label>
        <Input id="q" name="q" defaultValue={q} placeholder="دست‌کم دو نویسه…" />
      </form>
      {q.length < 2 ? (
        <EmptyState icon={<SearchIcon className="size-8" />} title="عبارتی برای جست‌وجو وارد کنید" />
      ) : (
        <PageState query={res} isEmpty={res.data?.groups.length === 0} empty={<EmptyState title={`نتیجه‌ای برای «${q}» یافت نشد`} />}>
          <div className="space-y-6">
            {res.data?.groups.map((g) => (
              <section key={g.provider}>
                <h2 className="mb-2 font-semibold">{g.title.fa}</h2>
                <div className="space-y-2">
                  {g.hits.map((h) => (
                    <Card key={h.entityId} className="p-4">
                      <Link to={h.link} className="font-medium text-primary">
                        {h.title}
                      </Link>
                      {h.snippet && <p className="mt-1 text-sm text-muted">{h.snippet}</p>}
                    </Card>
                  ))}
                </div>
              </section>
            ))}
          </div>
        </PageState>
      )}
    </>
  );
}
