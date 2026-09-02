do $$
begin
	if current_database() <> 'cm2_task8_acceptance_test' then
		raise exception 'CM-2 acceptance fixture refused database %', current_database();
	end if;
end
$$;

begin;

insert into roles (name, description, created_at, updated_at)
values (
	'CM2 E2E Content Editor',
	'Acceptance-only editor without asset upload permission',
	now(),
	now()
)
on conflict (name) do update
set description = excluded.description,
	updated_at = excluded.updated_at;

insert into role_permissions (role_id, permission_id)
select role_row.id, permission_row.id
from roles role_row
join permissions permission_row on permission_row.name = 'content.items.edit'
where role_row.name = 'CM2 E2E Content Editor'
on conflict do nothing;

insert into user_roles (user_id, role_id)
select assignment.user_id, role_row.id
from (
	values
		('seed-user-admin', 'Content Administrator'),
		('seed-user-alex', 'CM2 E2E Content Editor'),
		('seed-user-sam', 'Content Approver')
) as assignment(user_id, role_name)
join roles role_row on role_row.name = assignment.role_name
on conflict do nothing;

update users
set email_verified = true,
	updated_at = now()
where id = 'seed-user-sam';

insert into content_item (
	id,
	content_type,
	status,
	created_by,
	last_edited_by,
	created_at,
	updated_at
)
values (
	'8a810000-0000-4000-8000-000000000001',
	'advisory',
	'draft',
	'seed-user-admin',
	'seed-user-admin',
	now(),
	now()
)
on conflict (id) do nothing;

insert into content_version (
	id,
	item_id,
	version_no,
	status,
	content_type,
	title,
	summary,
	body,
	created_by,
	created_at
)
values (
	'8a810000-0000-4000-8000-000000000002',
	'8a810000-0000-4000-8000-000000000001',
	1,
	'draft',
	'advisory',
	'CM-2 governed asset acceptance',
	'Deterministic isolated acceptance draft',
	'Acceptance fixture content',
	'seed-user-admin',
	now()
)
on conflict (id) do nothing;

update content_item
set current_working_version_id = coalesce(
		current_working_version_id,
		'8a810000-0000-4000-8000-000000000002'
	)
where id = '8a810000-0000-4000-8000-000000000001';

commit;
