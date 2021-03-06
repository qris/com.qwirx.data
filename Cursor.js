/*
	@fileoverview Defines the {com.qwirx.data.Cursor} class, which
	wraps a {com.qwirx.data.Datasource} and a pointer to a specific,
	current record, like an Access Recordset.
*/

goog.provide('com.qwirx.data.Cursor');
goog.provide('com.qwirx.data.IllegalMove');
goog.provide('com.qwirx.data.FailedMove');

goog.require('com.qwirx.data.Datasource');
goog.require('com.qwirx.util.Enum');
goog.require('goog.events.EventTarget');

/**
	@class
		
	A Cursor wraps a com.qwirx.data.Datasource and a pointer to a
	specific, current record. It behaves a bit like an Access Recordset.
	
	You can move to the first, last, next or previous record, all
	of which fire events that you can listen for.
	
	It has a concept of a position (record number), which is just an
	index into the current (live) query results. The same record
	number may refer to	a different record if the data set changes
	under your feet (if you	want to return to the same record, use
	its ID). The position is always between 0 and the current row
	count ({#getRowCount}) minus one (unless the row count is unknown,
	when {#getRowCount} returns null), or one of the constants {#BOF},
	{#EOF} or {#NEW}. You can get the current position with
	{#getPosition} and set it directly with {#setPosition}.
	
	A Cursor provides access to the fields of the current record.
	Any changes to these field values in the Cursor will be lost if
	you navigate to a different record without calling the {#save}
	method. You can listen to the {#BEFORE_DISCARD} event to warn the
	user of this, and cancel the event if the user changes their mind,
	or the navigation was unintended.

	<p>BOF and EOF are never the same position, i.e. at least one
	{#moveForward} is required to move from BOF to EOF. This is because,
	at BOF, the Cursor has not attempted to retrieve a record,
	because you may not want to access the first record; and when you
	try, by calling {#moveForward}, it may discover that there are no
	records to retrieve. It would then place you at EOF, rather than
	throwing an exception, because this is a normal and not exceptional
	circumstance. Accessing any fields at BOF or EOF throws an
	exception.
	
	<p>The cursor position moves like this:
	
	<ul>
	<li>The cursor position always starts at BOF.
	<li>At BOF, {#movePrevious} throws an exception. Always check
	for BOF before calling movePrevious.
	<li>The first call to {#moveForward} sets the position to 0, if
	it finds at least one record in the dataset, otherwise EOF.
	<li>To iterate over all records you must call {#moveForward} at
	least once, and check whether {#isEOF} is then true.
	<li>At EOF, {#moveForward} throws an exception. Always check for
	EOF before calling moveForward.
	<li>{#moveFirst} moves the position to one after BOF. This
	will be EOF if the recordset is empty.</li>
	<li>{#moveLast} moves the position to one before EOF. This
	will be BOF if the recordset is empty.</li>
	</ul>
	
	For example:
	
	<pre>
	for (cursor.moveForward(); !cursor.isEOF(); cursor.moveForward())
	{ ... }
	</pre>

	@param {com.qwirx.data.Datasource} dataSource The data source
	which this Cursor should wrap.
	
	@param {com.qwirx.data.Datasource.AccessMode=} opt_accessMode
	You may get better performance from the	Cursor if you specify
	the type of access that you intend to perform on it, which it
	can use as a hint to prefetch an appropriate number of records.
*/
com.qwirx.data.Cursor = function(dataSource, opt_accessMode)
{
	this.dataSource_ = dataSource;
	this.position_ = com.qwirx.data.Cursor.BOF;
	
	dataSource.addEventListener(
		com.qwirx.data.Datasource.Events.ROWS_INSERT,
		this.handleDataSourceRowInsert, false /* capture */, 
		this /* scope */);
};
goog.inherits(com.qwirx.data.Cursor, goog.events.EventTarget);

com.qwirx.data.Cursor.AccessMode = new com.qwirx.util.Enum(
	'ALL_SEQUENTIAL', 'LINEAR_SEARCH', 'BINARY_SEARCH', 'RANDOM'
);

/**
	The initial recordset pointer, meaning "before the first record"
	or "no records have been retrieved yet".
	@const
*/
com.qwirx.data.Cursor.BOF = "BOF";

/**
	A recordset pointer meaning "after the last record", or
	"I tried to retrieve another record for you, and the Datasource
	told me that there were no more."
	@const
*/
com.qwirx.data.Cursor.EOF = "EOF";

/**
	A recordset pointer meaning "a new or unsaved record", or
	"This is the new record that I am building in memory for you."
	@const
*/
com.qwirx.data.Cursor.NEW = "NEW";

com.qwirx.data.Cursor.Events = new com.qwirx.util.Enum(
	'MOVE_FIRST', 'MOVE_BACKWARD', 'MOVE_FORWARD', 'MOVE_LAST',
	'MOVE_TO', 'CREATE_NEW', 'DELETE_CURRENT_ROW',
	'BEFORE_DISCARD', 'DISCARD', 'BEFORE_SAVE', 'SAVE',
	'BEFORE_OVERWRITE', 'OVERWRITE', 'MODIFIED'
);

/**
 * A base class for events that affect one row of the Cursor, or move 
 * the cursor position from one row to another, or request permission to
 * do so.
 * @constructor
 */ 
com.qwirx.data.Cursor.RowEvent = function(type, position)
{
	goog.base(this, type);
	this.position = position;
};
goog.inherits(com.qwirx.data.Cursor.RowEvent, goog.events.Event);

/**
 * @return the position of the Cursor that was affected or previously
 * occupied (starting position).
 * 
 * Note that the "position" of a SAVE event is the affected (newly created)
 * row index (a real row number), but the starting position (getPosition())
 * of the subsequent MOVE_TO event is the row that we were originally
 * positioned on before the movement, i.e. the NEW row, because the cursor
 * has moved from NEW to the newly created row.
 * 
 * Also note that if the MOVE_TO event is suppressed, then the cursor 
 * must remain positioned on NEW, although the record that's just been
 * created is no longer there. So although, usually, SaveEvent.getPosition()
 * returns the current cursor position (immediately after the SAVE), in this
 * case it does not, so it's not guaranteed.
 */
com.qwirx.data.Cursor.RowEvent.prototype.getPosition = function()
{
	return this.position;
};

/**
 * A base class for events that move the cursor position, or check for
 * permission to do so.
 * @constructor
 */ 
com.qwirx.data.Cursor.MovementEvent = function(type, oldPosition,
	newPosition)
{
	goog.base(this, type, oldPosition);
	this.newPosition = newPosition;
};
goog.inherits(com.qwirx.data.Cursor.MovementEvent, 
	com.qwirx.data.Cursor.RowEvent);
com.qwirx.data.Cursor.MovementEvent.prototype.getNewPosition = function()
{
	return this.newPosition;
};

/**
 * @return the number of rows in the underlying data source, or null
 * if the number is currently unknown.
 */
com.qwirx.data.Cursor.prototype.getRowCount = function()
{
	return this.dataSource_.getCount();
};

/**
 * @return the current position, which is an integer between 0 and
 * {com.qwirx.data.Cursor#getRowCount}() - 1, unless the row count is
 * unknown (null), in which case there is no upper bound; or one of the
 * constants
 * {com.qwirx.data.Cursor.BOF}, {com.qwirx.data.Cursor.EOF} or
 * {com.qwirx.data.Cursor.NEW}.
 */
com.qwirx.data.Cursor.prototype.getPosition = function()
{
	return this.position_;
};

/**
 * Sets the position FIRST, and THEN sends a MOVE_TO event. MOVE_TO is not
 * cancellable (BEFORE_MOVE_TO would be, if it existed) and therefore people
 * can expect the Cursor to be positioned on the new record when they receive
 * a MOVE_TO event, and the new data loaded. com.qwirx.grid.NavigationBar
 * relies on this.
 */
com.qwirx.data.Cursor.prototype.moveInternal = function(newPosition)
{
	var oldPosition = this.position_;
	this.position_ = newPosition;
	this.reloadRecord();
	this.dispatchEvent(new com.qwirx.data.Cursor.MovementEvent(
		com.qwirx.data.Cursor.Events.MOVE_TO, oldPosition, newPosition));
};

com.qwirx.data.Cursor.prototype.assertValidPosition = function(position)
{
	var rowCount = this.getRowCount();
	
	if (position == com.qwirx.data.Cursor.BOF ||
		position == com.qwirx.data.Cursor.EOF ||
		position == com.qwirx.data.Cursor.NEW ||
		(position >= 0 &&
		(rowCount == null || position < rowCount)))
	{
		return true;
	}
	else
	{
		throw new com.qwirx.data.IllegalMove("Invalid position: " +
			position);
	}
};

/**
 * @param newPosition the new position, which is an integer between
 * 0 and {com.qwirx.data.Cursor#getRowCount}() - 1, unless the row count is
 * unknown (null), in which case there is no upper bound; or one of the
 * constants {com.qwirx.data.Cursor.BOF}, {com.qwirx.data.Cursor.EOF} or
 * {com.qwirx.data.Cursor.NEW}. Setting the position to any other value
 * will throw an exception.
 *
 * This method calls {@link com.qwirx.data.Cursor.prototype.maybeDiscard}
 * before changing the position, which will throw an exception if
 * the current record is dirty and an event handler blocks the
 * {@link com.qwirx.data.Cursor.Events.BEFORE_DISCARD} event. This cancels
 * the change in position.
 *
 * The new record may not be retrieved immediately, depending on who's
 * listening to this Cursor; so if the record count
 * is currently unknown, then it's possible to set the position to an
 * invalid value. Actually retrieving the record (e.g. lazily, by
 * accessing its field values) may throw an exception if the position
 * was set to an invalid value. In this case, you may wish to handle
 * the exception by resetting the position to {#EOF}.
 *
 * @throws {com.qwirx.data.DiscardBlocked} if
 * {com.qwirx.data.Cursor.prototype.maybeDiscard} does.
 */
com.qwirx.data.Cursor.prototype.setPosition = function(newPosition)
{
	this.assertValidPosition(newPosition);
	this.maybeDiscard(newPosition);

	if (newPosition != this.position_)
	{
		this.moveInternal(newPosition);
	}
};

/**
 * Discard changes to the current record and reload it from the database.
 */
com.qwirx.data.Cursor.prototype.reloadRecord = function()
{
	if (this.position_ == com.qwirx.data.Cursor.BOF ||
		this.position_ == com.qwirx.data.Cursor.EOF)
	{
		this.currentRecordValues_ = null;
		this.currentRecordAsLoaded_ = null;
	}
	else if (this.position_ == com.qwirx.data.Cursor.NEW)
	{
		this.currentRecordValues_ = {};
		this.currentRecordAsLoaded_ = {};
	}
	else
	{
		this.currentRecordValues_ = {};
		this.currentRecordAsLoaded_ = {};
		var columns = this.dataSource_.getColumns();
		var record;
		
		if (this.position_ == com.qwirx.data.Cursor.NEW)
		{
			record = {};
		}
		else
		{
			record = this.dataSource_.get(this.position_);
		}
	
		for (var i = 0; i < columns.length; i++)
		{
			this.currentRecordValues_[columns[i].name] =
				this.currentRecordAsLoaded_[columns[i].name] =
				record[columns[i].name];
		}
	}
};

/**
 * @return the column definitions from the underlying data source.
 */
com.qwirx.data.Cursor.prototype.getColumns = function()
{
	return this.dataSource_.getColumns().slice(0); // copy
};

/**
 * @return true if the current position is at EOF, i.e. any attempt
 * to access data or move to the next record will throw an exception.
 */
com.qwirx.data.Cursor.prototype.isEOF = function()
{
	return this.position_ == com.qwirx.data.Cursor.EOF;
};

/**
 * @return true if the field values have been changed (the current
 * record is dirty).
 */
com.qwirx.data.Cursor.prototype.isDirty = function()
{
	var newValues = this.currentRecordValues_;
	var oldValues = this.currentRecordAsLoaded_;
	
	if (newValues == null)
	{
		// no record has been loaded, so it can't be dirty
		return false;
	}
	
	for (var prop in newValues)
	{
		if (!newValues.hasOwnProperty(prop)) continue;
		if (!oldValues.hasOwnProperty(prop)) return true;
		if (oldValues[prop] != newValues[prop]) return true;
	}
	
	for (var prop in oldValues)
	{
		if (!oldValues.hasOwnProperty(prop)) continue;
		if (!newValues.hasOwnProperty(prop)) return true;
		// if the property is in both, then it's already been compared
	}
	
	return false;
};

/**
 * If the field values have not been changed (the current record is
 * not dirty) then this function does nothing.
 *
 * Otherwise it fires a {com.qwirx.data.Cursor.Events.BEFORE_DISCARD}
 * event. If that event is not cancelled, a
 * {com.qwirx.data.Cursor.Events.DISCARD} event is fired, which cannot
 * be cancelled. The current record values are reset to their original
 * values when the current record was loaded. The database is not
 * requeried in case the record has changed, unless you explicitly
 * call {#reload} (in which case you don't need to call this function,
 * because {#reload} can do it for you).
 * 
 * @return true if the record can be discarded, false otherwise (if it
 * should not be discarded, but no exception was thrown).
 *
 * @throws {com.qwirx.data.DiscardBlocked} if a BEFORE_DISCARD event
 * was sent and cancelled by an event listener, without calling
 * event.preventDefault().
 * 
 * @param {integer=} opt_newPosition Will be stored in the BEFORE_DISCARD
 * and DISCARD events sent by the Cursor. If set, this would mean that we're
 * discarding changes in the process of navigating somewhere. In the case of
 * BEFORE_DISCARD, this allows the signal handler to prompt the user for
 * action, and later resume the requested navigation.
 */
com.qwirx.data.Cursor.prototype.maybeDiscard = function(opt_newPosition)
{
	if (this.isDirty())
	{
		this.assertCurrentRecord();
	}
	else
	{
		return true; // OK to move
	}
	
	var event = new com.qwirx.data.Cursor.MovementEvent(
		com.qwirx.data.Cursor.Events.BEFORE_DISCARD,
		this.getPosition(), opt_newPosition);
	var cancelled = !this.dispatchEvent(event);
	
	if (cancelled)
	{
		// com.qwirx.grid.Grid.prototype.handleDirtyMovement and other
		// Cursor users may need to prevent this exception being thrown,
		// if they plan to collect information (e.g. prompt the user)
		// and retry the movement later. We check whether the event
		// has preventDefault set and if so, don't throw an exception,
		// but return false instead. So callers must check for that
		// and not continue with the movement!
		
		// TODO this is a nonsense. It's not up to Grid to
		// decide whether Cursor should throw an exception or
		// not. We should be consistent and always throw an
		// exception if the save is cancelled. Callers can
		// catch it and ignore it if they want.
		
		throw new com.qwirx.data.DiscardBlocked("The cursor points " +
			"to modified data, and the BEFORE_DISCARD event was " +
			"cancelled, so the cursor cannot be moved.");
	}
	
	this.discard();
	return true;
};

/**
 * If the field values have not been changed (the current record is
 * not dirty) then this function does nothing.
 *
 * Otherwise it forces the current (modified) values to be discarded,
 * and fires a {com.qwirx.data.Cursor.Events.DISCARD} event, which cannot
 * be cancelled. The current record values are reset to their original
 * values when the current record was loaded. The database is not
 * requeried in case the record has changed, unless you explicitly
 * call {#reload} (in which case you don't need to call this function,
 * because {#reload} can do it for you).
 * 
 * @param {integer=} opt_newPosition Will be stored in the DISCARD event
 * sent by the Cursor to itself. If set, this would mean that we're
 * discarding changes in the process of navigating somewhere.
 */
com.qwirx.data.Cursor.prototype.discard = function(opt_newPosition)
{
	this.assertCurrentRecord();
	
	if (!this.isDirty())
	{
		return;
	}
	
	this.currentRecordValues_ = this.getLoadedValues(); // implicit clone
	this.dispatchEvent(
		new com.qwirx.data.Cursor.MovementEvent(
			com.qwirx.data.Cursor.Events.DISCARD,
			this.getPosition(), opt_newPosition));
	
	if (this.getPosition() == com.qwirx.data.Cursor.NEW)
	{
		this.setPosition(this.getRowCount() - 1);
	}
	
	this.dispatchEvent(new com.qwirx.data.Cursor.RowEvent(
		com.qwirx.data.Cursor.Events.MODIFIED, this.getPosition()));
};

/**
 * Move forward (if numRowsToMove > 0) or backward (if 
 * numRowsToMove < 0) or not at all (if numRowsToMove == 0).
 *
 * Calls {#maybeDiscard} to check whether modified field values
 * should be discarded, and if that throws an exception, the move is
 * cancelled and moveRelative propagates the exception.
 *
 * Otherwise a {#MOVE_FORWARD} and a {#MOVE_TO} event are fired.
 * 
 * If the data source has an unknown number of rows, we may move to
 * a record position that doesn't exist. This may result in an
 * exception being thrown when you try to access the current row's data. 
 * You may wish to respond to that exception by setting the current
 * position to {#EOF} at the time.
 *
 * @throws {com.qwirx.data.IllegalMove} if we're already at {#EOF}.
 * @return true if the move succeeded, false otherwise.
 */
com.qwirx.data.Cursor.prototype.moveRelative = function(numRowsToMove)
{
	var newPosition = this.position_;
	var rowCount = this.getRowCount();

	if (numRowsToMove == 0)
	{
		// no change
	}
	else if (this.position_ == com.qwirx.data.Cursor.BOF)
	{
		if (numRowsToMove < 0)
		{
			throw new com.qwirx.data.IllegalMove("Currently at BOF; " +
				"there is no previous record");
		}
		else // numRowsToMove > 0
		{
			newPosition = numRowsToMove - 1;
		}
	}
	else if (this.position_ == com.qwirx.data.Cursor.EOF ||
		this.position_ == com.qwirx.data.Cursor.NEW)
	{
		if (numRowsToMove > 0)
		{
			throw new com.qwirx.data.IllegalMove("Currently at EOF; " +
				"there is no next record");
		}
		else if (rowCount == null)
		{
			throw new com.qwirx.data.IllegalMove("Currently at EOF " +
				"and row count is unknown; cannot calculate the " +
				"new position; use moveFirst() instead");
		}
		else
		{
			newPosition = rowCount + numRowsToMove;
		}
	}
	else
	{
		newPosition += numRowsToMove;
	}
	
	if (newPosition == com.qwirx.data.Cursor.BOF ||
		newPosition == com.qwirx.data.Cursor.EOF ||
		newPosition == com.qwirx.data.Cursor.NEW)
	{
		// no adjustment necessary or possible
	}
	else if (newPosition < 0)
	{
		newPosition = com.qwirx.data.Cursor.BOF;
	}
	else if (rowCount != null && newPosition >= rowCount)
	{
		newPosition = com.qwirx.data.Cursor.EOF;
	}

	this.assertValidPosition(newPosition);
	this.maybeDiscard(newPosition);

	this.dispatchEvent({
		type: com.qwirx.data.Cursor.Events.MOVE_FORWARD,
		numRows: numRowsToMove,
		newPosition: newPosition
		});

	this.setPosition(newPosition);
	return true;
};

/**
 * Move to the first row. If the number of rows is known and zero,
 * this moves to EOF, otherwise to row 0.
 */
com.qwirx.data.Cursor.prototype.moveFirst = function()
{
	var rowCount = this.getRowCount();
	var newPosition = 0;
	
	if (rowCount != null && rowCount == 0)
	{
		newPosition = com.qwirx.data.Cursor.EOF;
	}

	this.dispatchEvent({
		type: com.qwirx.data.Cursor.Events.MOVE_FIRST,
		newPosition: newPosition
		});

	this.setPosition(newPosition);
};

/**
 * Move to the last row. Illegal if the number of rows is unknown.
 */
com.qwirx.data.Cursor.prototype.moveLast = function()
{
	var rowCount = this.getRowCount();
	if (rowCount == null)
	{
		throw new com.qwirx.data.IllegalMove("Cannot move to end " +
			"with an unknown number of rows");
	}
	
	var newPosition = rowCount - 1;

	this.dispatchEvent({
		type: com.qwirx.data.Cursor.Events.MOVE_LAST,
		newPosition: newPosition
		});

	this.setPosition(newPosition);
};

/**
 * Move to a new, blank row at the end of the data.
 */
com.qwirx.data.Cursor.prototype.moveNew = function()
{
	var newPosition = com.qwirx.data.Cursor.NEW;

	this.dispatchEvent({
		type: com.qwirx.data.Cursor.Events.CREATE_NEW,
		newPosition: newPosition
		});

	this.setPosition(newPosition);
};

/**
 * Handle an event from the datasource saying that a row has been inserted,
 * by updating our position if necessary to stay on the same row.
 */
com.qwirx.data.Cursor.prototype.handleDataSourceRowInsert = function(event)
{
	var affected = event.getAffectedRows();
	var oldPosition = this.position_;
	var newPosition = oldPosition;
	
	for (var i = 0; i < affected.length; i++)
	{
		var rowIndex = affected[i];
		if (rowIndex <= newPosition)
		{
			newPosition++;
		}
	}
	
	if (newPosition != oldPosition)
	{
		// don't discard data being edited, as would happen if we called
		// setPosition(), because there's no need.
		this.moveInternal(newPosition);
	}
};

/**
 * An exception thrown by {@link com.qwirx.data.Cursor#setFieldValue}
 * if there is no current record, because the cursor is positioned at
 * {com.qwirx.data.Cursor.BOF} or {com.qwirx.data.Cursor.EOF}.
 * @constructor
 */
com.qwirx.data.NoCurrentRecord = function(message)
{
	goog.base(this, message);
	this.message = message;
};
goog.inherits(com.qwirx.data.NoCurrentRecord, com.qwirx.util.Exception);

/**
 * An exception thrown by {@link com.qwirx.data.Cursor#setFieldValue}
 * if the specified field name is not a valid field/column for this
 * cursor.
 * @constructor
 */
com.qwirx.data.NoSuchField = function(message)
{
	goog.base(this, message);
	this.message = message;
};
goog.inherits(com.qwirx.data.NoSuchField, com.qwirx.util.Exception);

com.qwirx.data.Cursor.prototype.assertCurrentRecord = function()
{
	if (this.position_ == com.qwirx.data.Cursor.BOF ||
		this.position_ == com.qwirx.data.Cursor.EOF)
	{
		throw new com.qwirx.data.NoCurrentRecord("The cursor " +
			"is at " + this.position_ + " which is not a valid " +
			"record, so the field values cannot be modified.");
	}
};

com.qwirx.data.Cursor.prototype.assertValidField = function(fieldName)
{
	var columns = this.dataSource_.getColumns();
	var fieldNames = [];
	
	for (var i = 0; i < columns.length; i++)
	{
		if (columns[i].name == fieldName)
		{
			return;
		}
		
		fieldNames.push(columns[i].name);
	}
	
	throw new com.qwirx.data.NoSuchField("The field " + fieldName +
		" does not exist in this cursor. Valid fields are: " +
		fieldNames.join(" "));
};

/**
 * Sets the value of a field of the current record.
 * @param {String} fieldName the name of the field to modify
 * @param newValue the new value of the field, which can be of any
 * type.
 * @throws {com.qwirx.data.NoCurrentRecord} if the cursor is at
 * {com.qwirx.data.Cursor.BOF} or {com.qwirx.data.Cursor.EOF}.
 * @throws {com.qwirx.data.NoSuchField} if the supplied field name
 * does not exist in the current record.
 */
com.qwirx.data.Cursor.prototype.setFieldValue = function(fieldName,
	newValue)
{
	this.assertCurrentRecord();
	this.assertValidField(fieldName);
	this.currentRecordValues_[fieldName] = newValue;
	this.dispatchEvent(new com.qwirx.data.Cursor.RowEvent(
		com.qwirx.data.Cursor.Events.MODIFIED, this.getPosition()));
};

/**
 * A generic exception superclass for illegal or blocked cursor
 * movement attempts.
 * @constructor
 */
com.qwirx.data.CursorMovementException = function(message)
{
	goog.base(this, message);
};
goog.require('com.qwirx.util.Exception');
goog.inherits(com.qwirx.data.CursorMovementException,
	com.qwirx.util.Exception);

/**
 * An exception response to an illegal movement attempt,
 * such as moving to the previous record from BOF or the next record
 * from EOF, which is never allowed and should not be offered to the
 * user.
 * @constructor
 */
com.qwirx.data.IllegalMove = function(message)
{
	goog.base(this, message);
};
goog.inherits(com.qwirx.data.IllegalMove,
	com.qwirx.data.CursorMovementException);

/**
 * An exception response to a movement attempt which is blocked by
 * a {@link com.qwirx.data.Cursor.Events.BEFORE_DISCARD} event handler
 * cancelling the event, perhaps because the user has unsaved changes
 * that they wish not to discard yet.
 * @constructor
 */
com.qwirx.data.DiscardBlocked = function(message)
{
	goog.base(this, message);
};
goog.inherits(com.qwirx.data.DiscardBlocked,
	com.qwirx.data.CursorMovementException);

/**
 * An exception response to a save attempt which is blocked by
 * a {@link com.qwirx.data.Cursor.Events.BEFORE_SAVE} event handler
 * cancelling the event, perhaps because the record is invalid and cannot
 * be saved.
 * @constructor
 */
com.qwirx.data.SaveBlocked = function(message)
{
	goog.base(this, message);
};
goog.inherits(com.qwirx.data.SaveBlocked, com.qwirx.util.Exception);

/**
 * An exception response to a movement attempt which is blocked by
 * a {@link com.qwirx.data.Cursor.Events.BEFORE_OVERWRITE} event handler
 * cancelling the event, perhaps because the user decided not to
 * overwrite the record that changed under their feet.
 * @constructor
 */
com.qwirx.data.OverwriteBlocked = function()
{
	goog.base(this, "The record in the datasource has changed since " +
		"we loaded it, and the BEFORE_OVERWRITE event was cancelled, " +
		"so the cursor has not saved the current record.");
};
goog.inherits(com.qwirx.data.OverwriteBlocked,
	com.qwirx.data.CursorMovementException);

/**
 * @return the value of the named field when this record was loaded,
 * as opposed to its current value.
 * @throws {com.qwirx.data.NoCurrentRecord} if the cursor is at
 * {com.qwirx.data.Cursor.BOF} or {com.qwirx.data.Cursor.EOF}.
 */
com.qwirx.data.Cursor.prototype.getLoadedValues = function()
{
	this.assertCurrentRecord();
	return goog.object.clone(this.currentRecordAsLoaded_);
};

/**
 * @return the current, possibly unsaved values of all fields in the
 * current record.
 * @throws {com.qwirx.data.NoCurrentRecord} if the cursor is at
 * {com.qwirx.data.Cursor.BOF} or {com.qwirx.data.Cursor.EOF}.
 */
com.qwirx.data.Cursor.prototype.getCurrentValues = function()
{
	this.assertCurrentRecord();
	return goog.object.clone(this.currentRecordValues_);
};

/**
 * Write the current record to the {com.qwirx.data.Datasource}. This
 * only makes sense when the cursor is positioned on a current record
 * or at {com.qwirx.data.Cursor.NEW}. A
 * {@link com.qwirx.data.Cursor.Events.SAVE} event will be sent afterwards,
 * and if the cursor was previously at {com.qwirx.data.Cursor.NEW}, then
 * it will be moved to the position of the newly created record.
 * 
 * If the cursor is positioned on an existing record, it will normally 
 * check before overwriting it that the record values have not changed 
 * since it was loaded into the cursor. This protects against concurrent 
 * modification of the same Datasource (or underlying data source) by 
 * independent Cursors or other means.
 * 
 * If the record has been modified, a
 * {@link com.qwirx.data.Cursor.Events.BEFORE_OVERWRITE} event will be sent,
 * and if this event is cancelled, the save method will throw a 
 * {@link com.qwirx.data.OverwriteBlocked} exception instead of overwriting
 * the data in the Cursor. If the event is not intercepted or a handler
 * returns true, then the modified record in the datasource will be
 * overwritten, and a {@link com.qwirx.data.Cursor.Events.OVERWRITE} event
 * will be sent.
 * 
 * If opt_forceOverwrite is true, then we don't check whether the record
 * was modified underneath, and therefore we don't send an OVERWRITE event.
 * 
 * @param {boolean} opt_suppressMoveToEvent set to true if you want to
 * suppress the automatic MOVE_TO event caused by moving the cursor from
 * a NEW row to a newly created real row. For example, you might do this
 * if you're about to move the cursor again, because the save() was part
 * of handling a requested movement away from a dirty row.
 * 
 * If the movement event is suppressed, and we were saving a new
 * record, then we're still positioned on NEW because we haven't sent
 * a MOVE_TO event to indicate that we've moved elsewhere. So the
 * newly saved record is elsewhere, and the current one is empty.
 *
 * Also note the subtle inconsistency between SaveEvent.getPosition()
 * and Cursor.getPosition() in this case, as described in
 * {com.qwirx.data.Cursor.RowEvent.prototype#getPosition}.
 * 
 * @param {boolean} opt_forceOverwrite If set to true, the check for the
 * record having been concurrently modified in the underlying datasource
 * will be skipped, and the BEFORE_OVERWRITE and OVERWRITE events will not
 * be sent.
 * 
 * @param {number} opt_attemptedPosition If the save() is part of a movement
 * process, then pass the new target position. If a BEFORE_OVERWRITE event is
 * sent, it will be sent as a MovementEvent instead of a RowEvent, and
 * listeners will be able to discover the target row. Grid uses this to
 * complete the attempted movement when the user eventually tells us what
 * to do, by clicking on a button in the dialog. We do not actually complete
 * the movement ourselves, that's your responsibility!
 * 
 * @throws {com.qwirx.data.NoCurrentRecord} if the cursor is at
 * {com.qwirx.data.Cursor.BOF} or {com.qwirx.data.Cursor.EOF}.
 */
com.qwirx.data.Cursor.prototype.save = function(opt_suppressMoveToEvent,
	opt_forceOverwrite, opt_attemptedPosition)
{
	this.assertCurrentRecord();
	var newPosition = this.position_;
	
	if (this.position_ == com.qwirx.data.Cursor.NEW)
	{
		newPosition = this.dataSource_.add(this.currentRecordValues_);
	}
	else if (opt_forceOverwrite)
	{
		this.dataSource_.replace(this.position_, this.currentRecordValues_);
	}
	else
	{
		try
		{
			this.dataSource_.atomicReplace(this.position_,
				this.currentRecordAsLoaded_, this.currentRecordValues_);
		}
		catch (exception)
		{
			if (exception instanceof com.qwirx.data.ConcurrentModification)
			{
				var event;
				
				if (opt_attemptedPosition !== undefined)
				{
					event = new com.qwirx.data.Cursor.MovementEvent(
						com.qwirx.data.Cursor.Events.BEFORE_OVERWRITE,
						this.getPosition(), opt_attemptedPosition);
				}
				else
				{
					event = new com.qwirx.data.Cursor.RowEvent(
						com.qwirx.data.Cursor.Events.BEFORE_OVERWRITE,
						this.getPosition());
				}
				
				var cancelled = !this.dispatchEvent(event);
				
				if (cancelled)
				{
					throw new com.qwirx.data.OverwriteBlocked();
				}
				else
				{
					this.dataSource_.replace(this.position_,
						this.currentRecordValues_);
					this.dispatchEvent(
						new com.qwirx.data.Cursor.RowEvent(
							com.qwirx.data.Cursor.Events.OVERWRITE,
							this.getPosition()));
				}
			}
			else
			{
				throw exception;
			}
		}
	}
	
	this.reloadRecord();
	this.dispatchEvent(new com.qwirx.data.Cursor.RowEvent(
		com.qwirx.data.Cursor.Events.SAVE, newPosition));
	
	if (newPosition != this.position_ && !opt_suppressMoveToEvent)
	{
		this.moveInternal(newPosition);
	}
	
	return newPosition;
};

