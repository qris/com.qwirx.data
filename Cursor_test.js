goog.provide('com.qwirx.data.Cursor_test');

goog.require('com.qwirx.data.Cursor');
goog.require('com.qwirx.data.SimpleDatasource');
goog.require('com.qwirx.test.assertThrows');
goog.require('com.qwirx.test.findDifferences');
goog.require('goog.testing.jsunit');

function getTestDataSource()
{
	var columns = [{name: 'id', caption: 'ID'},
		{name: 'name', caption: 'Name'}];
	var data = [
		{id: 1, name: 'John'},
		{id: 2, name: 'James'},
		{id: 5, name: 'Peter'},
	];
	return new com.qwirx.data.SimpleDatasource(columns, data);
}

function blockDiscards(cursor)
{
	function blockEvent(e)
	{
		return false;
	}

	// Install an event handler which blocks discards if the current
	// record is dirty. We don't modify the record, so it should not
	// become dirty during all these moves, and this handler should
	// never be called.
	cursor.addEventListener(com.qwirx.data.Cursor.Events.BEFORE_DISCARD,
		blockEvent);
}

function test_cursor_positioning()
{
	var ds = getTestDataSource();
	var c = new com.qwirx.data.Cursor(ds);
	assertEquals(com.qwirx.data.Cursor.BOF, c.getPosition());
	assertEquals(ds.getCount(), c.getRowCount());
	blockDiscards(c);

	com.qwirx.test.assertThrows(com.qwirx.data.IllegalMove,
		function() { c.moveRelative(-1); });

	assertTrue(c.moveRelative(0));
	assertEquals(com.qwirx.data.Cursor.BOF, c.getPosition());
	
	assertTrue(c.moveRelative(1));
	assertEquals(0, c.getPosition());

	assertTrue(c.moveRelative(0));
	assertEquals(0, c.getPosition());

	assertTrue(c.moveRelative(1));
	assertEquals(1, c.getPosition());

	assertTrue(c.moveRelative(-1));
	assertEquals(0, c.getPosition());

	assertTrue(c.moveRelative(2));
	assertEquals(2, c.getPosition());

	assertTrue(c.moveRelative(-3));
	assertEquals(com.qwirx.data.Cursor.BOF, c.getPosition());

	assertTrue(c.moveRelative(4));
	assertEquals(com.qwirx.data.Cursor.EOF, c.getPosition());

	com.qwirx.test.assertThrows(com.qwirx.data.IllegalMove,
		function() { c.moveRelative(1); });

	com.qwirx.test.assertThrows(com.qwirx.data.IllegalMove,
		function() { c.setPosition(-1); });
	
	com.qwirx.test.assertThrows(com.qwirx.data.IllegalMove,
		function() { c.setPosition(c.getRowCount()); });
	
	assertTrue(c.moveRelative(-1));
	assertEquals(2, c.getPosition());
	
	assertTrue(c.moveRelative(-1));
	assertEquals(1, c.getPosition());

	assertTrue(c.moveRelative(0));
	assertEquals(1, c.getPosition());

	assertTrue(c.moveRelative(-1));
	assertEquals(0, c.getPosition());

	assertTrue(c.moveRelative(-1));
	assertEquals(com.qwirx.data.Cursor.BOF, c.getPosition());
	
	// BOF is not a valid position. Check that setFieldValue throws
	// exception as expected
	com.qwirx.test.assertThrows(com.qwirx.data.NoCurrentRecord,
		function() { c.setFieldValue('foo', 'bar'); });
	com.qwirx.test.assertThrows(com.qwirx.data.NoCurrentRecord,
		function() { c.setFieldValue('foo', 'bar'); });
	com.qwirx.test.assertThrows(com.qwirx.data.NoCurrentRecord,
		function() { c.getLoadedValues().foo; });
	// Even if the field name is valid
	com.qwirx.test.assertThrows(com.qwirx.data.NoCurrentRecord,
		function() { c.setFieldValue('name', 'bar'); });

	c.setPosition(0);

	// There is no field called 'foo' in this cursor.
	com.qwirx.test.assertThrows(com.qwirx.data.NoSuchField,
		function() { c.setFieldValue('foo', 'bar'); });

	// But there is one called 'name'.		
	c.setFieldValue('name', 'whee'); // no exception
	
	// And setting it should cause the record to be dirty, which we
	// detect by blocking discard events and catching the exception.
	com.qwirx.test.assertThrows(com.qwirx.data.DiscardBlocked,
		function() { c.maybeDiscard(0); });

	// Check that relative and absolute movements also check
	// whether the record should be discarded, and throw the
	// exception if not.
	com.qwirx.test.assertThrows(com.qwirx.data.DiscardBlocked,
		function() { c.setPosition(0); },
		"setPosition should call maybeDiscard, even when the relative " +
		"movement distance is zero (no change to position)");
	com.qwirx.test.assertThrows(com.qwirx.data.DiscardBlocked,
		function() { c.moveRelative(1); },
		"moveRelative should call maybeDiscard");
	
	// Set it back to what it was, check that all functions work again
	c.setFieldValue('name', ds.get(0)['name']);
	c.maybeDiscard(0);
	c.setPosition(0);
	c.moveRelative(1);
	
	// Set it to a different value, and then reset it
	c.setFieldValue('name', 'whee');
	c.setFieldValue('name', c.getLoadedValues().name);
	
	// Check that it's not seen as dirty
	c.maybeDiscard(0);
	c.setPosition(0);
	c.moveRelative(1);
}

function test_cursor_save_record()
{
	var ds = getTestDataSource();
	var c = new com.qwirx.data.Cursor(ds);
	c.setPosition(1);
	c.setFieldValue('id', 'foo');
	c.save();
	assertObjectEquals("Updated values should have been stored in the " +
		"datasource", {id: 'foo', name: 'James'}, ds.get(1));
}

function assert_cursor_new_record_creation(suppress_move_to_event)
{
	var ds = getTestDataSource();
	var c = new com.qwirx.data.Cursor(ds);
	blockDiscards(c);

	// Getting to NEW requires an explicit move
	var NEW = com.qwirx.data.Cursor.NEW;
	c.setPosition(NEW);
	assertEquals(NEW, c.getPosition());
	
	// All column values should be undefined here
	this.assertObjectEquals({}, c.getCurrentValues());
	this.assertObjectEquals({}, c.getLoadedValues());
	
	// We can set values too
	c.setFieldValue('id', 'foo');
	
	// The Cursor should know that the (new) record has been modified
	exception = assertThrows(function() { c.moveRelative(-1); });
	goog.asserts.assertInstanceof(exception, com.qwirx.data.DiscardBlocked,
		"DiscardBlocked exception should be an instance of " +
		"com.qwirx.data.DiscardBlocked, not " + exception + " (" +
		exception.type + ")");

	// Set another field value
	c.setFieldValue('name', 'bar');
	
	// Try to save the record.
	// This record goes to the end of the datasource
	var numRecords = ds.getCount();
	var actual_events = com.qwirx.test.assertEvents(c,
		[
			com.qwirx.data.Cursor.Events.SAVE,
			com.qwirx.data.Cursor.Events.MOVE_TO
		],
		function() // eventing_callback
		{
			c.save(suppress_move_to_event);
		},
		"Cursor.save() should have sent a SAVE event to the Cursor",
		suppress_move_to_event, // opt_continue_if_events_not_sent
		function(event) // opt_eventHandler
		{
			if (event.type == com.qwirx.data.Cursor.Events.SAVE)
			{
				assertEquals("The position recorded in the SAVE event " +
					"should be the new position of the newly saved record",
					numRecords, event.getPosition());
			}
			else if (event.type == com.qwirx.data.Cursor.Events.MOVE_TO &&
				!suppress_move_to_event)
			{
				assertEquals("The old position recorded in the MOVE_TO event " +
					"should be the previous cursor position, NEW",
					com.qwirx.data.Cursor.NEW, event.getPosition());
				assertEquals("The new position recorded in the MOVE_TO " +
					"event should be the new position of the cursor, which " +
					"is the new position of the newly saved record",
					numRecords, event.getNewPosition());
			}
			else
			{
				fail("Unexpected " + event.type + " event sent to Cursor");
			}
		});
	
	assertEquals(numRecords + 1, ds.getCount());
	
	if (suppress_move_to_event)
	{
		assertEquals("No MOVE_TO event should have been sent if it's " +
			"suppressed", 1, actual_events.length);
		assertEquals("Because the MOVE_TO event was suppressed, for " +
			"consistency the cursor should still be positioned at NEW",
			com.qwirx.data.Cursor.NEW, c.getPosition());
		assertObjectEquals("Because the MOVE_TO event was suppressed, and " +
			"the cursor is still on NEW after save(), it should be a " +
			"different NEW record, i.e. an empty one", {},
			c.getCurrentValues());
	}
	else
	{
		assertEquals(numRecords, c.getPosition());
		assertObjectEquals("The saved values should still be the current " +
			"values of the current record", {id: 'foo', name: 'bar'},
			c.getCurrentValues());
	}
}

function test_cursor_new_record_creation()
{
	assert_cursor_new_record_creation(false);
	assert_cursor_new_record_creation(undefined); // same as omitting parameter
	assert_cursor_new_record_creation(true); // try suppressing the MOVE_TO
}

/**
 * Inserting a row before the current position should change it.
 */
function test_cursor_positioning_after_insert()
{
	var ds = getTestDataSource();
	var c = new com.qwirx.data.Cursor(ds);
	var n = {id: "hello", name: "world"};
	
	c.setPosition(2);
	ds.insert(3, n);
	assertEquals("inserting a row after the current position should not " +
		"have changed it", 2, c.getPosition());
	ds.insert(2, n);
	assertEquals("inserting a row before the current position should " +
		"have changed it", 3, c.getPosition());
	ds.insert(1, n);
	assertEquals("inserting a row before the current position should " +
		"have changed it", 4, c.getPosition());
	ds.insert(0, n);
	assertEquals("inserting a row before the current position should " +
		"have changed it", 5, c.getPosition());
}

function test_cursor_events()
{
	var ds = getTestDataSource();
	var c = new com.qwirx.data.Cursor(ds);
	blockDiscards(c);
	
	c.setPosition(2);
	c.setFieldValue('name', 'Stuart');
	assertTrue(c.isDirty());
	var expectedNewPosition;
	var events = com.qwirx.test.assertEvents(c,
		[com.qwirx.data.Cursor.Events.BEFORE_DISCARD], 
		function() {
			expectedNewPosition = 2 - 1;
			com.qwirx.test.assertThrows(com.qwirx.data.DiscardBlocked,
				function() { c.moveRelative(-1); });
			expectedNewPosition = 0;
			com.qwirx.test.assertThrows(com.qwirx.data.DiscardBlocked,
				function() { c.setPosition(0); });
		},
		"Moving off a modified record should have sent a BEFORE_DISCARD event",
		false /* opt_continue_if_events_not_sent */,
		function(event) // opt_eventHandler
		{
			assertEquals(2, event.getPosition());
			assertEquals(expectedNewPosition, event.getNewPosition());
		});
	assertEquals(2, events.length);
}

function test_illegal_moves_from_dirty_records()
{
	var ds = getTestDataSource();
	var c = new com.qwirx.data.Cursor(ds);
	blockDiscards(c);
	
	c.setPosition(0);
	c.setFieldValue('id', 'dirty');
	assertTrue(c.isDirty());
	
	/*
	// Can't test this: moveRelative automatically adjusts out of bounds
	// accesses to be within the valid range.
	com.qwirx.test.assertThrows(com.qwirx.data.IllegalMove,
		function() { c.moveRelative(-2); });
	*/

	com.qwirx.test.assertThrows(com.qwirx.data.IllegalMove,
		function() { c.setPosition(-1); });
	
	com.qwirx.test.assertThrows(com.qwirx.data.IllegalMove,
		function() { c.setPosition(c.getRowCount()); });
}
	
function test_save_on_modified_record_sends_event()
{
	var ds = getTestDataSource();
	var c1 = new com.qwirx.data.Cursor(ds);
	var c2 = new com.qwirx.data.Cursor(ds);
	
	c1.setPosition(1);
	c2.setPosition(1);
	
	c1.setFieldValue('name', 'Stuart');
	c2.setFieldValue('name', 'Jonathan');
	
	c1.save();
	
	function trySave(trigger, events, handler)
	{
		return com.qwirx.test.assertEvents(c2,
			events,
			trigger,
			"Saving a record that was modified by someone else should have " +
			"sent a BEFORE_OVERWRITE event",
			false /* opt_continue_if_events_not_sent */,
			function handler_wrapper(event) // opt_eventHandler
			{
				goog.asserts.assertInstanceof(event,
					com.qwirx.data.Cursor.RowEvent,
					"BEFORE_OVERWRITE event should be an instance of " +
					"com.qwirx.data.Cursor.RowEvent, not " + event +
					" (" + event.type + ")");
				return handler(event);
			});
	}
	
	// Cancel the event. This should result in an exception being thrown.
	trySave(
		function() { // trigger
			com.qwirx.test.assertThrows(com.qwirx.data.OverwriteBlocked,
				function() { c2.save(); });
		},
		[com.qwirx.data.Cursor.Events.BEFORE_OVERWRITE], // events
		function(event) { // event handler
			// don't call event.preventDefault();
			return false;
		});
	assertObjectEquals("The underlying object should not have been changed",
		{id: 2, name: 'Stuart'}, ds.get(1));
	
	// Allow the event. This should result in the record being saved.
	trySave(
		function() { // trigger
			c2.save();
		},
		[ // events
			com.qwirx.data.Cursor.Events.BEFORE_OVERWRITE,
			com.qwirx.data.Cursor.Events.OVERWRITE
		],
		function(event) { // event handler
			// don't call event.preventDefault();
			return true;
		});
	assertObjectEquals("The underlying object should have been changed",
		{id: 2, name: 'Jonathan'}, ds.get(1));
}

function test_cursor_discard()
{
	var ds = getTestDataSource();
	var c = new com.qwirx.data.Cursor(ds);
	c.setPosition(1);
	
	assertEquals('James', c.getLoadedValues().name);
	
	c.setFieldValue('name', 'Joyce');
	assertTrue(c.isDirty());
	
	c.discard();
	assertFalse(c.isDirty());
	
	// discard() used to assign the loaded values instead of copying,
	// which broke the isDirty() method and subsequent atomic saves.
	
	c.setFieldValue('name', 'Jocelyn');
	assertTrue("Making changes to the current values in a Cursor should " +
		"make it dirty again", c.isDirty());
	assertEquals('James', c.getLoadedValues().name);
}


