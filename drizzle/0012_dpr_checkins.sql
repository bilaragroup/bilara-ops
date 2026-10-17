-- Three photo check-ins a day on the DPR (morning, noon, evening).
CREATE TABLE IF NOT EXISTS "site_dpr_checkins" (_row integer PRIMARY KEY, "Checkin_ID", "Request_ID", "DPR_ID", "Project_ID", "Work_Date", "Slot", "On_Time", "Masons", "Labourers", "Progress_Percent", "Progress_Note", "Materials_JSON", "Photo_Folder", "Photo_Count", "Captured_At", "Created_At", "Created_By");
