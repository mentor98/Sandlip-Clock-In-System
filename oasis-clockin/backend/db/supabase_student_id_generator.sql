-- ==============================================================================
-- Supabase Database Automation: Automatic Sequential Student ID Generator
-- ==============================================================================
-- You can run this in your Supabase SQL Editor if you would like the database
-- itself to guarantee auto-generated student IDs even if inserted directly.
-- Note: The application already handles this automatically at the API layer!
-- ==============================================================================

-- 1. Create a function that determines the next sequential student ID
CREATE OR REPLACE FUNCTION generate_next_student_id()
RETURNS TRIGGER AS $$
DECLARE
  highest_num INT := 0;
  next_num INT := 1;
  id_record RECORD;
  num_match TEXT;
BEGIN
  -- Only generate if student_id is omitted, null, empty, or 'AUTO'
  IF NEW.student_id IS NULL OR TRIM(NEW.student_id) = '' OR UPPER(TRIM(NEW.student_id)) = 'AUTO' THEN
    
    -- Scan existing students to find the highest number
    FOR id_record IN SELECT student_id FROM students WHERE student_id IS NOT NULL LOOP
      num_match := substring(id_record.student_id from '(\d+)$');
      IF num_match IS NOT NULL AND num_match != '' THEN
        IF num_match::INT > highest_num THEN
          highest_num := num_match::INT;
        END IF;
      END IF;
    END LOOP;

    next_num := highest_num + 1;
    NEW.student_id := 'SAN-2026-' || lpad(next_num::TEXT, 3, '0');
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 2. Attach the trigger to the students table before insert
DROP TRIGGER IF EXISTS trigger_auto_assign_student_id ON students;

CREATE TRIGGER trigger_auto_assign_student_id
BEFORE INSERT ON students
FOR EACH ROW
EXECUTE FUNCTION generate_next_student_id();
