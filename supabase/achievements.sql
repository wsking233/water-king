-- AC-01: private dynamic achievement projection; no permanent awards or rewards.
create function waterking_private.achievement_page()
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare uid uuid; stamp timestamptz:=statement_timestamp(); f record; result jsonb;
begin
 uid:=waterking_private.require_active_user(false);
 select * into f from waterking_private.achievement_facts(uid,stamp);
 with catalog(id,title,description,target,unit,progress,position) as (values
 ('first_record','初次记录','留下第一条饮水或嘘嘘记录',1,'条',f.record_count,1),
 ('record_days_3','三天记录','累计在3个北京日期留下记录',3,'天',f.record_days,2),
 ('record_days_7','一周积累','累计在7个北京日期留下记录',7,'天',f.record_days,3),
 ('record_days_30','三十天记录','累计在30个北京日期留下记录',30,'天',f.record_days,4),
 ('streak_3','连续三天','历史最长连续记录达到3天',3,'天',f.longest_streak,5),
 ('streak_7','连续一周','历史最长连续记录达到7天',7,'天',f.longest_streak,6),
 ('goal_days_3','目标起步','可靠历史目标完成3天',3,'天',f.goal_days,7),
 ('goal_days_7','七日目标','可靠历史目标完成7天',7,'天',f.goal_days,8),
 ('goal_days_30','三十日目标','可靠历史目标完成30天',30,'天',f.goal_days,9)
 )
 select jsonb_build_object('rulesVersion',1,'updatedAt',stamp,'day',(stamp at time zone 'Asia/Shanghai')::date,
 'incompleteGoalHistory',f.goal_history_incomplete,
 'achievedCount',count(*) filter(where progress>=target),
 'items',jsonb_agg(jsonb_build_object('id',id,'title',title,'description',description,
 'target',target,'unit',unit,'progress',least(progress,target),'achieved',progress>=target) order by position)) into result from catalog;
 return result;
end $$;
revoke all on function waterking_private.achievement_page() from public,anon,authenticated;
grant execute on function waterking_private.achievement_page() to authenticated;
create function public.achievement_page() returns jsonb language sql stable security invoker set search_path='' as $$
 select waterking_private.achievement_page();
$$;
revoke all on function public.achievement_page() from public,anon,authenticated;
grant execute on function public.achievement_page() to authenticated;
