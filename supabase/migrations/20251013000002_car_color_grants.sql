revoke execute on function
  accounts.my_profile(), accounts.update_profile(text, text, boolean, text, text, boolean), crews.list_my_crews()
  from public, anon;
grant execute on function
  accounts.my_profile(), accounts.update_profile(text, text, boolean, text, text, boolean), crews.list_my_crews()
  to authenticated;
