-- Machine translations wait for the founder's check before others see them.
alter table devotion_translations add column if not exists approved boolean not null default false;
update devotion_translations set approved = true where source = 'phaneroo';
