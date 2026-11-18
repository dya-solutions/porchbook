-- A Phaneroo YouTube live video the studio pasted by hand (backup for the
-- automatic "is Phaneroo live?" check). One row; it counts for 6 hours.
create table if not exists fm_live_video (
  id integer primary key default 1,
  video_id text not null,
  set_at timestamptz not null default now()
);
