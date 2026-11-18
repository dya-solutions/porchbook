-- The founder approved: the manual card shows to everyone.
update app_flags set enabled = true where key = 'manual_card';
