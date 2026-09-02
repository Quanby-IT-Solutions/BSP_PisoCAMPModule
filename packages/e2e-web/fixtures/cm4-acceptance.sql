-- CM-4 acceptance fixture: an item published from a prior approved version, so
-- version history has a restorable source that is not the working version.
do $$
begin
	if current_database() <> 'cm5_acceptance_test' then
		raise exception 'CM-4 acceptance fixture refused database %', current_database();
	end if;
end
$$;

begin;

insert into content_item (
	id, content_type, status, created_by, last_edited_by, created_at, updated_at
) values (
	'9c5b0000-0000-4000-8000-000000000052', 'advisory', 'published',
	'seed-user-admin', 'seed-user-admin', now(), now()
) on conflict (id) do nothing;

insert into content_version (
	id, item_id, version_no, parent_version_id, status, content_type, title, summary, body,
	created_by, created_at, approved_by, approved_at, published_by, published_at,
	transition_action, transition_comments
) values
	(
		'9c5b0000-0000-4000-8000-000000000081', '9c5b0000-0000-4000-8000-000000000052', 1, null,
		'draft', 'advisory', 'Care for your banknotes', 'First draft of the handling advisory.',
		'Do not fold or staple Philippine banknotes.',
		'seed-user-admin', now(), null, null, null, null, null, null
	),
	(
		'9c5b0000-0000-4000-8000-000000000082', '9c5b0000-0000-4000-8000-000000000052', 2,
		'9c5b0000-0000-4000-8000-000000000081', 'submitted_for_review', 'advisory',
		'Care for your banknotes', 'First draft of the handling advisory.',
		'Do not fold or staple Philippine banknotes.',
		'seed-user-admin', now(), null, null, null, null, 'submit', 'Ready for review'
	),
	(
		'9c5b0000-0000-4000-8000-000000000083', '9c5b0000-0000-4000-8000-000000000052', 3,
		'9c5b0000-0000-4000-8000-000000000082', 'approved', 'advisory',
		'Care for your banknotes', 'Approved handling advisory.',
		'Do not fold, staple or write on Philippine banknotes.',
		'seed-user-admin', now(), 'seed-user-admin', now(), null, null, 'approve',
		'Checked against the BSP source'
	),
	(
		'9c5b0000-0000-4000-8000-000000000084', '9c5b0000-0000-4000-8000-000000000052', 4,
		'9c5b0000-0000-4000-8000-000000000083', 'published', 'advisory',
		'Care for your banknotes', 'Approved handling advisory.',
		'Do not fold, staple or write on Philippine banknotes.',
		'seed-user-admin', now(), 'seed-user-admin', now(), 'seed-user-admin', now(), 'publish', null
	)
on conflict (id) do nothing;

insert into related_link (content_version_id, position, kind, label, external_url)
values
	('9c5b0000-0000-4000-8000-000000000083', 0, 'external', 'BSP handling guidance',
		'https://www.bsp.gov.ph/Pages/CoinsAndNotes/CleanNotePolicy.aspx')
on conflict do nothing;

update content_item
set current_working_version_id = '9c5b0000-0000-4000-8000-000000000084',
	current_published_version_id = '9c5b0000-0000-4000-8000-000000000084'
where id = '9c5b0000-0000-4000-8000-000000000052';

commit;
