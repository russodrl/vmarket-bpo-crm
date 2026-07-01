create or replace function public.record_linked_record_field_history()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  old_json jsonb;
  new_json jsonb;
  key text;
  label text;
  rec record;
  ignored text[] := array['updated_at'];
  entity_title text;
begin
  if tg_op <> 'UPDATE' then
    return new;
  end if;
  old_json := to_jsonb(old);
  new_json := to_jsonb(new);
  entity_title := case
    when tg_table_name = 'organizations' then coalesce(new_json ->> 'name', old_json ->> 'name', 'empresa')
    else coalesce(new_json ->> 'full_name', old_json ->> 'full_name', 'contato')
  end;
  for key in select jsonb_object_keys(new_json)
  loop
    if key = any(ignored) then
      continue;
    end if;
    if (old_json -> key) is distinct from (new_json -> key) then
      label := public.crm_history_label(tg_table_name, key);
      for rec in execute format(
        'select id from public.deals where %I = $1',
        case when tg_table_name = 'organizations' then 'organization_id' else 'person_id' end
      ) using new.id
      loop
        insert into public.deal_history (deal_id, event_type, title, description, actor_id)
        values (
          rec.id,
          case when tg_table_name = 'organizations' then 'Empresa' else 'Contato' end,
          case when tg_table_name = 'organizations' then 'Campo da empresa alterado: ' else 'Campo do contato alterado: ' end || label,
          label || ' de ' || entity_title || ' mudou de "' || public.crm_history_value(old_json -> key) || '" para "' || public.crm_history_value(new_json -> key) || '".',
          auth.uid()
        );
      end loop;
    end if;
  end loop;
  return new;
end;
$$;
