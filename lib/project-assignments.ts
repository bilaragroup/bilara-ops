// Derive access from committed project assignments within the same transaction.
export function refreshProjectAccess(db:D1Database,event:string){
 const expression=`COALESCE((SELECT json_group_array(project) FROM (
  SELECT p.project FROM project_configs p WHERE p.active=1 AND app_users.active=1 AND (
   (p.manager_email=app_users.email AND EXISTS(SELECT 1 FROM json_each(app_users.roles) WHERE value='Project Manager')) OR
   (EXISTS(SELECT 1 FROM json_each(p.qc_emails) WHERE value=app_users.email) AND EXISTS(SELECT 1 FROM json_each(app_users.roles) WHERE value='QC')) OR
   (EXISTS(SELECT 1 FROM json_each(p.engineer_emails) WHERE value=app_users.email) AND EXISTS(SELECT 1 FROM json_each(app_users.roles) WHERE value='Site Engineer'))
  ) ORDER BY p.project)), '[]')`;
 return db.prepare(`UPDATE app_users SET projects=${expression},version=version+1
  WHERE EXISTS(SELECT 1 FROM history WHERE id=?)
  AND EXISTS(SELECT 1 FROM json_each(app_users.roles) WHERE value IN ('Project Manager','QC','Site Engineer'))
  AND projects<>${expression}`).bind(event);
}
