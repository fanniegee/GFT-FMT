-- Remove qualifiers placed after Guvaza, preserving bracketed middle names.
CREATE OR REPLACE FUNCTION gft_clean_person_name(value text) RETURNS text
LANGUAGE sql IMMUTABLE STRICT AS $$
  SELECT regexp_replace(value, '(\mGuvaza\M)[[:space:]]*\([^()]*\)([[:space:]]*\([^()]*\))*[[:space:]]*$', '\1', 'i')
$$;

CREATE OR REPLACE FUNCTION gft_clean_name_fields(value jsonb) RETURNS jsonb
LANGUAGE plpgsql IMMUTABLE STRICT AS $$
DECLARE result jsonb; item record; cleaned jsonb; has_suffix boolean;
BEGIN
  IF jsonb_typeof(value) = 'array' THEN
    SELECT COALESCE(jsonb_agg(gft_clean_name_fields(element) ORDER BY ordinal), '[]'::jsonb)
      INTO result FROM jsonb_array_elements(value) WITH ORDINALITY AS entries(element, ordinal);
    RETURN result;
  ELSIF jsonb_typeof(value) <> 'object' THEN
    RETURN value;
  END IF;
  result := '{}'::jsonb;
  has_suffix := false;
  FOR item IN SELECT key, val FROM jsonb_each(value) AS entries(key,val) LOOP
    cleaned := gft_clean_name_fields(item.val);
    IF jsonb_typeof(item.val) = 'string'
       AND lower(replace(item.key, '_', '')) IN
         ('name','fullname','displayname','parentname','parentfullname','grandparentname','grandparentfullname',
          'sendername','recipientname','beneficiaryname','holdername','cardholdername') THEN
      cleaned := to_jsonb(gft_clean_person_name(item.val #>> '{}'));
      has_suffix := has_suffix OR (lower(replace(item.key, '_', '')) IN ('name','fullname','displayname') AND cleaned IS DISTINCT FROM item.val);
    END IF;
    result := result || jsonb_build_object(item.key, cleaned);
  END LOOP;
  IF has_suffix THEN
    FOR item IN SELECT key, val FROM jsonb_each(result) AS entries(key,val) LOOP
      IF lower(replace(item.key, '_', '')) = 'currentsurname' THEN
        result := jsonb_set(result, ARRAY[item.key], '"Guvaza"'::jsonb);
      ELSIF item.key = 'profile' AND jsonb_typeof(item.val) = 'object' THEN
        IF item.val ? 'currentSurname' THEN
          result := jsonb_set(result, ARRAY['profile','currentSurname'], '"Guvaza"'::jsonb);
        END IF;
      END IF;
    END LOOP;
  END IF;
  RETURN result;
END
$$;

CREATE OR REPLACE FUNCTION gft_clean_person_row() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW := jsonb_populate_record(NEW, gft_clean_name_fields(to_jsonb(NEW)));
  RETURN NEW;
END
$$;

DO $$
DECLARE entry record; field text; assignments text; condition text;
BEGIN
  FOR entry IN
    SELECT table_name,
      array_agg(column_name::text) FILTER (WHERE column_name IN (
        'name','full_name','display_name','parent_name','parent_full_name','grandparent_name','grandparent_full_name',
        'sender_name','recipient_name','beneficiary_name','holder_name','card_holder_name'
      ) AND data_type IN ('text','character varying')) AS names,
      array_agg(column_name::text) FILTER (WHERE data_type = 'jsonb') AS objects
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name IN (
        'family_people','beneficiaries','beneficiary_family_members','registrations','users',
        'gft_admin_accounts','gft_department_staff','clinic_staff_users','clinic_staff_invitations',
        'spotlight_member_accounts','spotlight_profiles','spotlight_collaborations',
        'configuration','correction_requests','registration_attempts'
      )
    GROUP BY table_name
  LOOP
    assignments := '';
    condition := '';
    FOREACH field IN ARRAY COALESCE(entry.names, ARRAY[]::text[]) LOOP
      assignments := assignments || format('%I = gft_clean_person_name(%I),', field, field);
      condition := condition || format(' OR %I IS DISTINCT FROM gft_clean_person_name(%I)', field, field);
    END LOOP;
    FOREACH field IN ARRAY COALESCE(entry.objects, ARRAY[]::text[]) LOOP
      assignments := assignments || format('%I = gft_clean_name_fields(%I),', field, field);
      condition := condition || format(' OR %I IS DISTINCT FROM gft_clean_name_fields(%I)', field, field);
    END LOOP;
    IF assignments <> '' THEN
      -- Clean surname metadata while the original full name still identifies affected rows.
      IF entry.names @> ARRAY['full_name'] THEN
        IF entry.objects @> ARRAY['profile'] THEN
          EXECUTE format(
            'UPDATE public.%I SET profile = jsonb_set(profile, ''{currentSurname}'', ''"Guvaza"''::jsonb)
             WHERE full_name IS DISTINCT FROM gft_clean_person_name(full_name)
               AND jsonb_typeof(profile) = ''object'' AND profile ? ''currentSurname''', entry.table_name);
        END IF;
        IF EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_schema='public' AND table_name=entry.table_name AND column_name='current_surname') THEN
          EXECUTE format('UPDATE public.%I SET current_surname=''Guvaza''
            WHERE full_name IS DISTINCT FROM gft_clean_person_name(full_name)', entry.table_name);
        END IF;
      END IF;
      EXECUTE format('UPDATE public.%I SET %s WHERE %s', entry.table_name,
        left(assignments, length(assignments)-1), substring(condition FROM 5));
      EXECUTE format('DROP TRIGGER IF EXISTS gft_person_name_cleanup ON public.%I', entry.table_name);
      EXECUTE format('CREATE TRIGGER gft_person_name_cleanup BEFORE INSERT OR UPDATE ON public.%I
        FOR EACH ROW EXECUTE FUNCTION gft_clean_person_row()', entry.table_name);
    END IF;
  END LOOP;
END
$$;

